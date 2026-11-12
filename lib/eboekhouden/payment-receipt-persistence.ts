import "server-only";
import { randomUUID } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { getDb } from "@/lib/db";
import type { ReceiptClaim, ReceiptJob, ReceiptScope, ReceiptSettings, ReceiptStore } from "./payment-receipt-contract";

type Execute = <T extends Record<string, unknown>>(statement: SQL) => Promise<{ rows: T[] }>;
// A lease is longer than the bounded provider requests. Expiry permits read-only
// reconciliation of an attempted request, never another financial POST.
const lease = sql`interval '15 minutes'`;
const jobColumns = sql`id, tenant_id as "tenantId", mode, payment_id as "paymentId", invoice_id as "invoiceId",
  mollie_payment_id as "molliePaymentId", profile_id as "profileId", clearing_ledger_id as "clearingLedgerId",
  credential_version::text as "credentialVersion", payload, invoice_snapshot as "invoiceSnapshot", status,
  attempted_at::text as "attemptedAt", mutation_id as "mutationId", claim_token as "claimToken", error_code as "errorCode"`;

function assertScope(scope: ReceiptScope) {
  if (!scope.tenantId?.trim() || scope.mode !== "live") throw new Error("Explicit tenant and live receipt scope required.");
}

function settingsMatch(settings: ReceiptSettings) {
  return sql`s.tenant_id = ${settings.tenantId} and s.mode = ${settings.mode} and s.enabled = true
    and s.profile_id = ${settings.profileId} and s.clearing_ledger_id = ${settings.clearingLedgerId}
    and s.payments_from = ${settings.paymentsFrom}::timestamptz
    and s.credential_version = ${settings.credentialVersion}::timestamptz
    and c.updated_at = s.credential_version`;
}

function claimMatch(input: ReceiptClaim) {
  assertScope(input);
  if (!input.claimToken?.trim()) throw new Error("Receipt claim token required.");
  return sql`id = ${input.id} and tenant_id = ${input.tenantId} and mode = ${input.mode}
    and claim_token = ${input.claimToken} and claimed_at > now() - ${lease}`;
}

/** SQL is injected only for in-memory PostgreSQL tests; production uses getDb. */
export function createReceiptStore(execute: Execute): ReceiptStore {
  return {
    async getSettings(scope) {
      assertScope(scope);
      const result = await execute<ReceiptSettings & { credentialCurrent: boolean | null }>(sql`
        select s.tenant_id as "tenantId", s.mode, s.enabled, s.profile_id as "profileId",
          s.clearing_ledger_id as "clearingLedgerId", s.payments_from::text as "paymentsFrom",
          s.credential_version::text as "credentialVersion", s.cursor_payment_id as "cursorPaymentId",
          c.updated_at = s.credential_version as "credentialCurrent"
        from tenant_eboekhouden_receipt_settings s
        left join tenant_eboekhouden_credentials c on c.tenant_id = s.tenant_id
        where s.tenant_id = ${scope.tenantId} and s.mode = ${scope.mode}
      `);
      const row = result.rows[0];
      if (!row) return null;
      const { credentialCurrent, ...settings } = row;
      if (settings.enabled && credentialCurrent !== true) throw new Error("Receipt accounting configuration requires review.");
      return settings;
    },
    async getJob(input) {
      assertScope(input);
      const result = await execute<ReceiptJob>(sql`select ${jobColumns} from eboekhouden_payment_receipts
        where tenant_id = ${input.tenantId} and mode = ${input.mode} and payment_id = ${input.paymentId}`);
      return result.rows[0] ?? null;
    },
    async claim({ settings, link, evidence }) {
      assertScope(settings);
      if (!settings.enabled || link.tenantId !== settings.tenantId || link.mode !== settings.mode ||
          !link.paymentId || !link.invoiceId || evidence.payload.ledgerId !== settings.clearingLedgerId ||
          evidence.payload.invoiceNumber !== link.invoiceNumber || evidence.payload.relationId !== link.relationId ||
          evidence.invoiceSnapshot.id !== Number(link.providerInvoiceId) || evidence.invoiceSnapshot.invoiceNumber !== link.invoiceNumber) return null;
      const claimToken = randomUUID();
      const inserted = await execute<ReceiptJob>(sql`
        insert into eboekhouden_payment_receipts (id, tenant_id, mode, payment_id, invoice_id, mollie_payment_id,
          profile_id, clearing_ledger_id, credential_version, payload, invoice_snapshot, claim_token, claimed_at)
        select ${randomUUID()}, s.tenant_id, s.mode, p.id, i.id, p.mollie_payment_id,
          s.profile_id, s.clearing_ledger_id, s.credential_version,
          ${JSON.stringify(evidence.payload)}::jsonb, ${JSON.stringify(evidence.invoiceSnapshot)}::jsonb, ${claimToken}, now()
        from tenant_eboekhouden_receipt_settings s
        join tenant_eboekhouden_credentials c on c.tenant_id = s.tenant_id
        join payments p on p.tenant_id = s.tenant_id and p.mode = s.mode
        join invoices i on i.tenant_id = p.tenant_id and i.mode = p.mode
        where ${settingsMatch(settings)} and p.id = ${link.paymentId} and p.mollie_payment_id = ${link.molliePaymentId}
          and p.mollie_status = 'paid' and p.paid_at >= s.payments_from
          and p.paid_at <= now() and p.amount_currency = 'EUR' and p.amount_value = ${evidence.payload.rows[0].amount}
          and (p.paid_at at time zone 'Europe/Amsterdam')::date::text = ${evidence.payload.date}
          and p.disputed_at is null and p.collection_review_required_at is null
          and i.id = ${link.invoiceId} and i.provider = 'eboekhouden' and i.voided_at is null
          and i.provider_invoice_id = ${link.providerInvoiceId} and i.provider_invoice_number = ${link.invoiceNumber}
          and ((i.owner_type = 'payment' and i.owner_id = p.id and p.payment_type = 'first') or
            (i.owner_type = 'recurring_schedule' and p.payment_type = 'recurring' and exists (
              select 1 from recurring_billing_schedules r
              join subscriptions subscription on subscription.id = r.subscription_id and subscription.tenant_id = r.tenant_id and subscription.mode = r.mode
              where r.id = i.owner_id and r.payment_id = p.id and r.subscription_id = p.subscription_id
                and subscription.customer_id = p.customer_id and r.tenant_id = p.tenant_id and r.mode = p.mode)))
        on conflict do nothing returning ${jobColumns}
      `);
      if (inserted.rows[0]) return inserted.rows[0];
      // Reclaim only the exact existing ownership. Never replace frozen evidence,
      // clear attempted_at, or reset posting/review_required to prepared.
      const reclaimed = await execute<ReceiptJob>(sql`
        update eboekhouden_payment_receipts set claim_token = ${claimToken}, claimed_at = now(), updated_at = now()
        where tenant_id = ${settings.tenantId} and mode = ${settings.mode}
          and payment_id = ${link.paymentId} and invoice_id = ${link.invoiceId} and mollie_payment_id = ${link.molliePaymentId}
          and profile_id = ${settings.profileId} and clearing_ledger_id = ${settings.clearingLedgerId}
          and credential_version = ${settings.credentialVersion}::timestamptz and status <> 'verified'
          and (claim_token is null or claimed_at <= now() - ${lease})
          and exists (select 1 from tenant_eboekhouden_receipt_settings s
            join tenant_eboekhouden_credentials c on c.tenant_id = s.tenant_id where ${settingsMatch(settings)})
        returning ${jobColumns}
      `);
      return reclaimed.rows[0] ?? null;
    },
    async markPosting(input) {
      assertScope(input.settings);
      if (!input.settings.enabled || input.tenantId !== input.settings.tenantId || input.mode !== input.settings.mode) return false;
      const result = await execute<{ id: string }>(sql`
        update eboekhouden_payment_receipts j set status = 'posting', attempted_at = now(), error_code = null, updated_at = now()
        where ${claimMatch(input)} and status = 'prepared' and attempted_at is null
          and profile_id = ${input.settings.profileId} and clearing_ledger_id = ${input.settings.clearingLedgerId}
          and credential_version = ${input.settings.credentialVersion}::timestamptz
          and exists (select 1 from tenant_eboekhouden_receipt_settings s
            join tenant_eboekhouden_credentials c on c.tenant_id = s.tenant_id
            join payments p on p.tenant_id = s.tenant_id and p.mode = s.mode and p.id = j.payment_id
            join invoices i on i.id = j.invoice_id and i.tenant_id = j.tenant_id and i.mode = j.mode
            where ${settingsMatch(input.settings)} and p.mollie_status = 'paid' and p.paid_at >= s.payments_from
              and p.paid_at <= now() and p.amount_currency = 'EUR' and p.amount_value = (j.payload #>> '{rows,0,amount}')::numeric
              and (p.paid_at at time zone 'Europe/Amsterdam')::date::text = j.payload ->> 'date'
              and p.disputed_at is null and p.collection_review_required_at is null
              and i.provider = 'eboekhouden' and i.voided_at is null and i.provider_invoice_id = j.invoice_snapshot ->> 'id'
              and i.provider_invoice_number = j.invoice_snapshot ->> 'invoiceNumber'
              and ((i.owner_type = 'payment' and i.owner_id = p.id and p.payment_type = 'first') or
                (i.owner_type = 'recurring_schedule' and p.payment_type = 'recurring' and exists (
                  select 1 from recurring_billing_schedules r
                  join subscriptions subscription on subscription.id = r.subscription_id and subscription.tenant_id = r.tenant_id and subscription.mode = r.mode
                  where r.id = i.owner_id and r.payment_id = p.id and r.subscription_id = p.subscription_id
                    and subscription.customer_id = p.customer_id and r.tenant_id = p.tenant_id and r.mode = p.mode))))
        returning id
      `);
      return result.rows.length === 1;
    },
    async markVerified(input) {
      if (!Number.isSafeInteger(input.mutationId) || input.mutationId <= 0) throw new Error("Valid receipt mutation ID required.");
      const result = await execute<{ id: string }>(sql`update eboekhouden_payment_receipts
        set status = 'verified', mutation_id = ${input.mutationId}, claim_token = null, error_code = null, updated_at = now()
        where ${claimMatch(input)} and status in ('prepared', 'posting', 'review_required') returning id`);
      return result.rows.length === 1;
    },
    async markReview(input) {
      if (!/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(input.errorCode)) throw new Error("Safe receipt error code required.");
      const result = await execute<{ id: string }>(sql`update eboekhouden_payment_receipts
        set status = 'review_required', error_code = ${input.errorCode}, claim_token = null, updated_at = now()
        where ${claimMatch(input)} and status in ('prepared', 'posting', 'review_required') returning id`);
      return result.rows.length === 1;
    },
    async releasePrepared(input) {
      const result = await execute<{ id: string }>(sql`update eboekhouden_payment_receipts
        set claim_token = null, updated_at = now()
        where ${claimMatch(input)} and status = 'prepared' and attempted_at is null returning id`);
      return result.rows.length === 1;
    },
  };
}

/** Cursor is scheduling progress only; it never changes any financial claim. */
export function createReceiptCursorAdvancer(execute: Execute) {
  return async (settings: ReceiptSettings, paymentId: string): Promise<void> => {
    assertScope(settings);
    if (!settings.enabled || !paymentId.trim() || paymentId !== paymentId.trim()) throw new Error("Receipt cursor scope is invalid.");
    const result = await execute<{ tenantId: string }>(sql`
      update tenant_eboekhouden_receipt_settings s set cursor_payment_id = ${paymentId}, updated_at = now()
      from tenant_eboekhouden_credentials c
      where c.tenant_id = s.tenant_id and ${settingsMatch(settings)}
        and exists (select 1 from payments p where p.tenant_id = s.tenant_id and p.mode = s.mode and p.id = ${paymentId})
      returning s.tenant_id as "tenantId"
    `);
    if (result.rows.length !== 1) throw new Error("Receipt cursor configuration changed.");
  };
}

async function executeProduction<T extends Record<string, unknown>>(statement: SQL): Promise<{ rows: T[] }> {
  const result = await getDb().execute<T>(statement);
  return { rows: result.rows as T[] };
}
export const receiptStore = createReceiptStore(executeProduction);
export const advanceReceiptCursor = createReceiptCursorAdvancer(executeProduction);
