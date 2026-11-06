import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import type { DeliveryInput } from "@/lib/invoice-delivery-batch";

function ownerTable(input: Pick<DeliveryInput, "invoiceType">) {
  return input.invoiceType === "first_payment" ? sql`payments` : sql`recurring_billing_schedules`;
}

export async function claimInvoiceEmailAttempt(input: DeliveryInput, token: string, recipient: string) {
  const result = await getDb().execute<{ id: string }>(sql`
    update ${ownerTable(input)} set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'invoiceDeliveryAttemptToken', ${token}::text, 'invoiceDeliveryAttemptState', 'sending',
      'invoiceDeliveryClaimedAt', now(), 'invoiceDeliveryRecipient', ${recipient}::text), updated_at = now()
    where id = ${input.entityId} and tenant_id = ${input.tenantId} and mode = ${input.mode}
      and (invoice_state = 'invoice_created' or (${input.allowResend === true} and invoice_state = 'invoice_sent'))
      and coalesce(metadata ->> 'invoiceDeliveryAttemptState', '') not in ('sending', 'uncertain', 'accepted')
    returning id
  `);
  return Boolean(result.rows[0]);
}

export async function recordInvoiceEmailAttempt(input: DeliveryInput, token: string, state: "accepted" | "failed" | "uncertain") {
  const result = await getDb().execute<{ id: string }>(sql`
    update ${ownerTable(input)} set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'invoiceDeliveryAttemptState', ${state}::text, 'invoiceDeliveryOutcomeAt', now()), updated_at = now()
    where id = ${input.entityId} and tenant_id = ${input.tenantId} and mode = ${input.mode}
      and metadata ->> 'invoiceDeliveryAttemptToken' = ${token}
    returning id
  `);
  if (!result.rows[0]) throw new Error("Invoice email attempt ownership changed.");
}

export async function finishAcceptedInvoiceEmails(input: { tenantId: string; mode: "live" | "test" }) {
  for (const table of [sql`payments`, sql`recurring_billing_schedules`]) {
    await getDb().execute(sql`
      update ${table} set invoice_state = 'invoice_sent', invoice_sent_at = coalesce(invoice_sent_at, now()),
        metadata = coalesce(metadata, '{}'::jsonb) || '{"invoiceDeliveryAttemptState":"sent","invoiceDeliveryStatus":"sent","invoiceDeliveryPermanentFailure":false,"invoiceDeliveryNextRetryAt":null}'::jsonb,
        updated_at = now()
      where tenant_id = ${input.tenantId} and mode = ${input.mode}
        and invoice_state in ('invoice_created', 'invoice_sent') and metadata ->> 'invoiceDeliveryAttemptState' = 'accepted'
    `);
  }
}
