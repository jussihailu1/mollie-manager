import { sql } from "drizzle-orm";

import { getDb, type DbClient } from "@/lib/db";
import type { MollieMode } from "@/lib/env";
import {
  buildDeterministicMatchCte,
  buildFirstPaymentFilter,
} from "@/lib/eboekhouden/first-payment-invoice-match-query";
import { toInvoiceCount } from "@/lib/eboekhouden/invoice-flow-helpers";

const TERMINAL_OR_IN_PROGRESS_STATES = [
  "invoice_creating",
  "invoice_created",
  "invoice_failed",
  "invoice_sent",
] as const;

type DueFirstPaymentInvoiceQueueSummary = {
  actionableCount: number;
  blockedCount: number;
  dueCount: number;
};

type DueFirstPaymentInvoiceCandidate = {
  paymentId: string;
};

async function resolveTenantId(tenantId?: string) {
  if (!tenantId) {
    throw new Error("Tenant id is required.");
  }

  return tenantId;
}

export async function listDueFirstPaymentInvoiceCandidates(
  mode: MollieMode,
  limit = 25,
  tenantId?: string,
) {
  const resolvedTenantId = await resolveTenantId(tenantId);
  const result = await getDb().execute<DueFirstPaymentInvoiceCandidate>(sql`
    ${buildDeterministicMatchCte({ mode, tenantId: resolvedTenantId })}
    select
      p.id as "paymentId"
    from payments p
    inner join deterministic_matches dm on dm.payment_id = p.id
    left join customers c
      on c.id = p.customer_id
      and c.tenant_id = p.tenant_id
      and c.mode = p.mode
    where p.tenant_id = ${resolvedTenantId}
      and p.mode = ${mode}
      and p.payment_type = 'first'
      and p.mollie_status = 'paid'
      and dm.consent_accepted_at is not null
      and dm.first_payment_mode = 'real_installment'
      and c.eboekhouden_relation_id is not null
      and p.invoice_state = 'pending_invoice'
      and p.eboekhouden_invoice_id is null
      and p.eboekhouden_invoice_number is null
    order by coalesce(p.paid_at, p.created_at) asc, p.created_at asc
    limit ${Math.max(1, limit)}
  `);

  return result.rows;
}

export async function normalizeFirstPaymentInvoiceStates(input?: {
  client?: DbClient;
  mode?: MollieMode;
  paymentId?: string;
  tenantId?: string;
}) {
  const db = input?.client ?? getDb();
  const filters = buildFirstPaymentFilter({
    mode: input?.mode,
    paymentId: input?.paymentId,
  });
  const resolvedTenantId = await resolveTenantId(input?.tenantId);
  const result = await db.execute<{ id: string }>(sql`
    ${buildDeterministicMatchCte({
      mode: input?.mode,
      paymentId: input?.paymentId,
      tenantId: resolvedTenantId,
    })}
    , normalized_targets as (
      select
        p.id as payment_id,
        case
          when dm.payment_id is not null
            and dm.consent_accepted_at is not null
            and dm.first_payment_mode = 'mandate_only'
          then 'skipped'::payment_invoice_state
          when dm.payment_id is not null
            and dm.consent_accepted_at is not null
            and dm.first_payment_mode = 'real_installment'
            and p.mollie_status = 'paid'
          then 'pending_invoice'::payment_invoice_state
          else 'not_applicable'::payment_invoice_state
        end as invoice_state
      from payments p
      left join deterministic_matches dm on dm.payment_id = p.id
      where ${filters}
        and p.tenant_id = ${resolvedTenantId}
    )
    update payments p
    set
      invoice_state = nt.invoice_state,
      updated_at = now()
    from normalized_targets nt
    where p.id = nt.payment_id
      and p.invoice_state not in (
        ${TERMINAL_OR_IN_PROGRESS_STATES[0]},
        ${TERMINAL_OR_IN_PROGRESS_STATES[1]},
        ${TERMINAL_OR_IN_PROGRESS_STATES[2]},
        ${TERMINAL_OR_IN_PROGRESS_STATES[3]}
      )
      and p.invoice_state is distinct from nt.invoice_state
    returning p.id as id
  `);

  return result.rows.length;
}

export async function getDueFirstPaymentInvoiceQueueSummary(
  mode: MollieMode,
  tenantId?: string,
): Promise<DueFirstPaymentInvoiceQueueSummary> {
  const resolvedTenantId = await resolveTenantId(tenantId);
  const result = await getDb().execute<{
    actionableCount: number | string;
    blockedCount: number | string;
    dueCount: number | string;
  }>(sql`
    ${buildDeterministicMatchCte({ mode, tenantId: resolvedTenantId })}
    select
      count(*) filter (where c.eboekhouden_relation_id is not null) as "actionableCount",
      count(*) filter (where c.eboekhouden_relation_id is null) as "blockedCount",
      count(*) as "dueCount"
    from payments p
    inner join deterministic_matches dm on dm.payment_id = p.id
    left join customers c
      on c.id = p.customer_id
      and c.tenant_id = p.tenant_id
      and c.mode = p.mode
    where p.tenant_id = ${resolvedTenantId}
      and p.mode = ${mode}
      and p.payment_type = 'first'
      and p.mollie_status = 'paid'
      and dm.consent_accepted_at is not null
      and dm.first_payment_mode = 'real_installment'
      and p.eboekhouden_invoice_id is null
      and p.eboekhouden_invoice_number is null
      and p.invoice_state not in (
        ${TERMINAL_OR_IN_PROGRESS_STATES[0]},
        ${TERMINAL_OR_IN_PROGRESS_STATES[1]},
        ${TERMINAL_OR_IN_PROGRESS_STATES[2]},
        ${TERMINAL_OR_IN_PROGRESS_STATES[3]}
      )
  `);
  const row = result.rows[0];

  return {
    actionableCount: toInvoiceCount(row?.actionableCount),
    blockedCount: toInvoiceCount(row?.blockedCount),
    dueCount: toInvoiceCount(row?.dueCount),
  };
}
