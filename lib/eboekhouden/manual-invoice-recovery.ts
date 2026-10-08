import "server-only";

import { sql } from "drizzle-orm";

import { getTenantBillingSettings } from "@/lib/billing-settings";
import { getDb } from "@/lib/db";
import { getEboekhoudenInvoice } from "@/lib/eboekhouden/client";
import { listFailedFirstPaymentRecoveryCandidates, storeRecoveredFailedFirstPaymentSuccess } from "@/lib/eboekhouden/first-payment-invoice-recovery";
import { verifiedEboekhoudenInvoice } from "@/lib/eboekhouden/invoice-total-verification";
import { listFailedRecurringRecoveryCandidates, storeRecoveredFailedInvoiceSuccess } from "@/lib/eboekhouden/recurring-invoice-recovery";
import { deliverCustomerInvoiceEmail } from "@/lib/invoice-delivery";
import { requireTaxTreatment } from "@/lib/invoicing/tax-treatment";

type ManualRecoveryInput = {
  apply: boolean;
  creditNoteNumber: string;
  creditedInvoiceId: number;
  mode: "live" | "test";
  ownerId: string;
  ownerType: "payment" | "recurring_schedule";
  operatorEmail: string;
  replacementInvoiceId: number;
  tenantId: string;
};

export async function recoverCreditedEboekhoudenInvoice(input: ManualRecoveryInput) {
  if (!Number.isSafeInteger(input.creditedInvoiceId) || input.creditedInvoiceId <= 0 ||
      !Number.isSafeInteger(input.replacementInvoiceId) || input.replacementInvoiceId <= 0 ||
      input.creditedInvoiceId === input.replacementInvoiceId || !input.creditNoteNumber.trim() ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.operatorEmail)) {
    throw new Error("Supply distinct original and replacement invoice IDs, the issued credit note number, and a valid operator email.");
  }

  const table = input.ownerType === "payment" ? sql`payments` : sql`recurring_billing_schedules`;
  const owner = await getDb().execute<{ originalInvoice: { id?: number } | null }>(sql`
    select metadata -> 'eboekhoudenUnverifiedInvoice' as "originalInvoice"
    from ${table}
    where id = ${input.ownerId} and tenant_id = ${input.tenantId}
      and mode = ${input.mode} and invoice_state = 'invoice_failed'
    limit 1
  `);
  if (owner.rows[0]?.originalInvoice?.id !== input.creditedInvoiceId) {
    throw new Error("The credited invoice ID does not match Kify's failed invoice record.");
  }

  const settings = await getTenantBillingSettings(input.tenantId);
  const taxTreatment = requireTaxTreatment(settings?.taxTreatment);
  const replacement = await getEboekhoudenInvoice(input.replacementInvoiceId, input.tenantId);
  if (replacement.id !== input.replacementInvoiceId) {
    throw new Error("e-Boekhouden returned a different replacement invoice ID.");
  }

  const actor = { kind: "user" as const, email: input.operatorEmail };
  const originalCreditNumber = input.creditNoteNumber.trim();
  if (input.ownerType === "payment") {
    const candidate = (await listFailedFirstPaymentRecoveryCandidates(input.mode, 1, input.tenantId, input.ownerId))[0];
    if (!candidate || replacement.relationId !== candidate.eboekhoudenRelationId) {
      throw new Error("Replacement invoice does not belong to the failed payment's e-Boekhouden relation.");
    }
    const verified = await verifiedEboekhoudenInvoice({
      expectedAmount: candidate.amountValue,
      expectedRelationId: candidate.eboekhoudenRelationId,
      invoice: replacement,
      taxTreatment: candidate.taxTreatment ? requireTaxTreatment(candidate.taxTreatment) : taxTreatment,
      tenantId: input.tenantId,
    });
    if (!input.apply) return { status: "verified" as const, invoiceNumber: verified.invoiceNumber ?? verified.number, totalAmount: verified.totalAmount, vatAmount: verified.vatAmount, taxTreatment: verified.apiVerification.taxTreatment };
    const stored = await storeRecoveredFailedFirstPaymentSuccess({ actor, candidate, invoice: verified, originalCreditNumber });
    if (!stored) throw new Error("Failed payment was already reconciled; no invoice was sent.");
    const delivery = await deliverCustomerInvoiceEmail({
      actor, customerEmail: candidate.customerEmail, customerId: candidate.customerId,
      entityId: candidate.paymentId, invoiceDocumentUrl: verified.urlPdfFile ?? null,
      invoiceId: stored.invoiceId, invoiceNumber: stored.invoiceNumber,
      invoiceProvider: "eboekhouden", invoiceType: "first_payment", mode: candidate.mode,
      subscriptionId: candidate.subscriptionId, tenantId: candidate.tenantId,
    });
    return { status: "reconciled" as const, invoiceNumber: stored.invoiceNumber, delivery };
  }

  const candidate = (await listFailedRecurringRecoveryCandidates(input.mode, 1, input.tenantId, input.ownerId))[0];
  if (!candidate || replacement.relationId !== candidate.eboekhoudenRelationId) {
    throw new Error("Replacement invoice does not belong to the failed schedule's e-Boekhouden relation.");
  }
  const verified = await verifiedEboekhoudenInvoice({
    expectedAmount: candidate.amountValue,
      expectedRelationId: candidate.eboekhoudenRelationId,
    invoice: replacement,
    taxTreatment: candidate.taxTreatment ? requireTaxTreatment(candidate.taxTreatment) : taxTreatment,
    tenantId: input.tenantId,
  });
  if (!input.apply) return { status: "verified" as const, invoiceNumber: verified.invoiceNumber ?? verified.number, totalAmount: verified.totalAmount, vatAmount: verified.vatAmount, taxTreatment: verified.apiVerification.taxTreatment };
  const stored = await storeRecoveredFailedInvoiceSuccess({ actor, candidate, invoice: verified, originalCreditNumber });
  if (!stored) throw new Error("Failed schedule was already reconciled; no invoice was sent.");
  const delivery = await deliverCustomerInvoiceEmail({
    actor, customerEmail: candidate.customerEmail, customerId: candidate.customerId,
    entityId: candidate.scheduleId, invoiceDocumentUrl: verified.urlPdfFile ?? null,
    invoiceId: stored.invoiceId, invoiceNumber: stored.invoiceNumber,
    invoiceProvider: "eboekhouden", invoiceType: "recurring", mode: candidate.mode,
    plannedCollectionDate: candidate.plannedCollectionDate,
    subscriptionId: candidate.subscriptionId, tenantId: candidate.tenantId,
  });
  return { status: "reconciled" as const, invoiceNumber: stored.invoiceNumber, delivery };
}
