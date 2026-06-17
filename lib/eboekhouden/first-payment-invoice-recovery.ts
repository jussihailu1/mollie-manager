import { sql } from "drizzle-orm";

import { writeAuditLog } from "@/lib/audit";
import { getDb } from "@/lib/db";
import type { EboekhoudenInvoice } from "@/lib/eboekhouden/client";
import { buildDeterministicMatchCte } from "@/lib/eboekhouden/first-payment-invoice-match-query";
import type { FirstPaymentInvoiceActor } from "@/lib/eboekhouden/first-payment-invoice-persistence";

export type FirstPaymentInvoiceRecoveryCandidate = {
  customerEmail: string | null;
  customerId: string | null;
  eboekhoudenRelationId: number;
  mode: "live" | "test";
  paidAt: string | null;
  paymentCreatedAt: string;
  paymentId: string;
  subscriptionId: string | null;
};

export async function listFailedFirstPaymentRecoveryCandidates(
  mode: "live" | "test",
  limit: number,
) {
  const result = await getDb().execute<FirstPaymentInvoiceRecoveryCandidate>(sql`
    ${buildDeterministicMatchCte({ mode })}
    select
      p.id as "paymentId",
      p.mode,
      p.customer_id as "customerId",
      p.subscription_id as "subscriptionId",
      p.paid_at as "paidAt",
      p.created_at as "paymentCreatedAt",
      c.email as "customerEmail",
      c.eboekhouden_relation_id as "eboekhoudenRelationId"
    from payments p
    inner join deterministic_matches dm on dm.payment_id = p.id
    inner join customers c on c.id = p.customer_id and c.mode = p.mode
    where p.mode = ${mode}
      and p.payment_type = 'first'
      and p.invoice_state = 'invoice_failed'
      and p.eboekhouden_invoice_id is null
      and p.eboekhouden_invoice_number is null
      and c.eboekhouden_relation_id is not null
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
      eboekhouden_invoice_id = ${invoiceId},
      eboekhouden_invoice_number = ${invoiceNumber},
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
      and eboekhouden_invoice_id is null
      and eboekhouden_invoice_number is null
    returning id
  `);

  if (!result.rows[0]?.id) {
    return null;
  }

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
