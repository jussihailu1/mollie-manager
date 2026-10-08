import { sql } from "drizzle-orm";

import { writeAuditLog } from "@/lib/audit";
import { getDb, transaction } from "@/lib/db";
import type { EboekhoudenInvoice } from "@/lib/eboekhouden/client";
import { buildDeterministicMatchCte } from "@/lib/eboekhouden/first-payment-invoice-match-query";
import type { FirstPaymentInvoiceActor } from "@/lib/eboekhouden/first-payment-invoice-persistence";
import { saveStoredInvoice } from "@/lib/invoices";
import type { TaxTreatment } from "@/lib/invoicing/tax-treatment";

export type FirstPaymentInvoiceRecoveryCandidate = {
  amountValue: string;
  customerEmail: string | null;
  customerId: string | null;
  eboekhoudenRelationId: number;
  mode: "live" | "test";
  paidAt: string | null;
  paymentCreatedAt: string;
  paymentId: string;
  subscriptionId: string | null;
  tenantId: string;
  taxTreatment: TaxTreatment | null;
};

export async function listFailedFirstPaymentRecoveryCandidates(
  mode: "live" | "test",
  limit: number,
  tenantId?: string,
  paymentId?: string,
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
      p.amount_value::text as "amountValue",
      p.metadata ->> 'invoiceTaxTreatment' as "taxTreatment",
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
      and ${paymentId ? sql`p.id = ${paymentId}` : sql`true`}
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
  originalCreditNumber?: string;
}) {
  const invoiceId = input.invoice.id ? String(input.invoice.id) : null;
  const invoiceNumber = input.invoice.invoiceNumber ?? input.invoice.number ?? null;
  const recovered = await transaction(async (tx) => {
    const result = await tx.execute<{ id: string }>(sql`
    update payments
    set
      invoice_state = 'invoice_created',
      invoice_created_at = coalesce(invoice_created_at, now()),
      invoice_failed_at = null,
      metadata = coalesce(metadata, '{}'::jsonb) || ${JSON.stringify({
        eboekhoudenInvoice: input.invoice,
        eboekhoudenUnverifiedInvoice: null,
        invoiceCreationManualReview: false,
        invoiceRecoveredAt: new Date().toISOString(),
        invoiceRecoverySource: input.originalCreditNumber ? "manual_replacement" : "reconciled_existing",
        invoiceOriginalCreditNumber: input.originalCreditNumber ?? null,
      })}::jsonb,
      updated_at = now()
    where id = ${input.candidate.paymentId}
      and tenant_id = ${input.candidate.tenantId}
      and mode = ${input.candidate.mode}
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
    if (!result.rows[0]?.id) return false;
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
    }, tx);
    await tx.execute(sql`
      update alerts set status = 'resolved', resolved_at = now(), updated_at = now()
      where tenant_id = ${input.candidate.tenantId} and status = 'open'
        and (
          (payload ->> 'kind' = 'first_payment_invoice_creation_failed' and payload ->> 'paymentId' = ${input.candidate.paymentId})
          or (payload ->> 'kind' = 'eboekhouden_invoice_verification_failed' and payload ->> 'ownerId' = ${input.candidate.paymentId})
        )
    `);
    return true;
  });

  if (!recovered) return null;

  await writeAuditLog(
    {
      action: "first_payment_invoice.recover_failed",
      details: {
        eboekhoudenInvoiceId: invoiceId,
        eboekhoudenInvoiceNumber: invoiceNumber,
        paymentId: input.candidate.paymentId,
        source: input.originalCreditNumber ? "manual_replacement" : "reconciled_existing",
        originalCreditNumber: input.originalCreditNumber ?? null,
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
