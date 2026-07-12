import { sql } from "drizzle-orm";

import { writeAuditLog } from "@/lib/audit";
import { getDb } from "@/lib/db";
import type { EboekhoudenInvoice } from "@/lib/eboekhouden/client";
import { buildDeterministicMatchCte } from "@/lib/eboekhouden/first-payment-invoice-match-query";
import type { FirstPaymentInvoiceActor } from "@/lib/eboekhouden/first-payment-invoice-persistence";
import { saveStoredInvoice } from "@/lib/invoices";

export type FirstPaymentInvoiceRecoveryCandidate = {
  customerEmail: string | null;
  customerId: string | null;
  eboekhoudenRelationId: number;
  mode: "live" | "test";
  paidAt: string | null;
  paymentCreatedAt: string;
  paymentId: string;
  subscriptionId: string | null;
  tenantId: string;
};

export async function listFailedFirstPaymentRecoveryCandidates(
  mode: "live" | "test",
  limit: number,
  tenantId?: string,
) {
  if (!tenantId) {
    throw new Error("First-payment invoice recovery tenant context is missing.");
  }

  const result = await getDb().execute<FirstPaymentInvoiceRecoveryCandidate>(sql`
    ${buildDeterministicMatchCte({ mode, tenantId })}
    select
      p.id as "paymentId",
      p.mode,
      p.tenant_id as "tenantId",
      p.customer_id as "customerId",
      p.subscription_id as "subscriptionId",
      p.paid_at as "paidAt",
      p.created_at as "paymentCreatedAt",
      c.email as "customerEmail",
      case
        when cal.provider_customer_id ~ '^[0-9]+$'
          then cal.provider_customer_id::int
        else null
      end as "eboekhoudenRelationId"
    from payments p
    inner join deterministic_matches dm on dm.payment_id = p.id
    inner join customers c
      on c.id = p.customer_id
      and c.mode = p.mode
      and c.tenant_id = p.tenant_id
    left join customer_accounting_links cal
      on cal.customer_id = c.id
      and cal.tenant_id = c.tenant_id
      and cal.mode = c.mode
      and cal.provider = 'eboekhouden'
    where p.mode = ${mode}
      and p.tenant_id = ${tenantId}
      and p.payment_type = 'first'
      and p.invoice_state = 'invoice_failed'
      and not exists (
        select 1
        from invoices i
        where i.tenant_id = p.tenant_id
          and i.owner_type = 'payment'
          and i.owner_id = p.id
      )
      and cal.provider_customer_id is not null
    order by p.updated_at asc, p.created_at asc
    limit ${Math.max(1, limit)}
  `);

  return result.rows;
}

export async function storeRecoveredFailedFirstPaymentSuccess(input: {
  actor: FirstPaymentInvoiceActor;
  candidate: FirstPaymentInvoiceRecoveryCandidate;
  invoice: EboekhoudenInvoice;
}) {
  const invoiceId = input.invoice.id ? String(input.invoice.id) : null;
  const invoiceNumber = input.invoice.invoiceNumber ?? input.invoice.number ?? null;
  const result = await getDb().execute<{ id: string }>(sql`
    update payments
    set
      invoice_state = 'invoice_created',
      invoice_created_at = coalesce(invoice_created_at, now()),
      invoice_failed_at = null,
      metadata = coalesce(metadata, '{}'::jsonb) || ${JSON.stringify({
        eboekhoudenInvoice: input.invoice,
        invoiceRecoveredAt: new Date().toISOString(),
        invoiceRecoverySource: "reconciled_existing",
      })}::jsonb,
      updated_at = now()
    where id = ${input.candidate.paymentId}
      and invoice_state = 'invoice_failed'
      and not exists (
        select 1
        from invoices i
        where i.tenant_id = payments.tenant_id
          and i.owner_type = 'payment'
          and i.owner_id = payments.id
      )
    returning id
  `);

  if (!result.rows[0]?.id) {
    return null;
  }

  await saveStoredInvoice({
    mode: input.candidate.mode,
    ownerId: input.candidate.paymentId,
    ownerType: "payment",
    provider: "eboekhouden",
    providerCustomerId: String(input.candidate.eboekhoudenRelationId),
    providerDocumentUrl: input.invoice.urlPdfFile ?? null,
    providerInvoiceId: invoiceId,
    providerInvoiceNumber: invoiceNumber,
    providerSnapshot: input.invoice as Record<string, unknown>,
    syncedAt: new Date().toISOString(),
    tenantId: input.candidate.tenantId,
  });

  await writeAuditLog(
    {
      action: "first_payment_invoice.recover_failed",
      details: {
        eboekhoudenInvoiceId: invoiceId,
        eboekhoudenInvoiceNumber: invoiceNumber,
        paymentId: input.candidate.paymentId,
        source: "reconciled_existing",
      },
      entityId: input.candidate.paymentId,
      entityType: "payment",
      mode: input.candidate.mode,
      outcome: "success",
      summary:
        "Recovered failed first-payment invoice row by reconciling existing e-Boekhouden invoice.",
    },
    undefined,
    input.actor,
  );

  return {
    invoiceId,
    invoiceNumber,
  };
}
