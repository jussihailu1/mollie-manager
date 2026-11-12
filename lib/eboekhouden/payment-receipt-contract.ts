import type { EboekhoudenInvoice } from "./client";
import type { ReceiptLink, ReceiptMutationInput } from "./payment-receipt-preview";

export type ReceiptScope = { tenantId: string; mode: "live" };
export type ReceiptSettings = ReceiptScope & {
  enabled: boolean;
  profileId: string;
  clearingLedgerId: number;
  paymentsFrom: string;
  credentialVersion: string;
  cursorPaymentId?: string | null;
};
export type ReceiptEvidence = {
  payload: ReceiptMutationInput;
  invoiceSnapshot: EboekhoudenInvoice;
};
export type ReceiptJob = ReceiptScope & ReceiptEvidence & {
  id: string;
  invoiceId: string;
  paymentId: string;
  molliePaymentId: string;
  profileId: string;
  clearingLedgerId: number;
  credentialVersion: string;
  status: "prepared" | "posting" | "verified" | "review_required";
  attemptedAt: string | null;
  mutationId: number | null;
  claimToken: string | null;
  errorCode: string | null;
};
export type ReceiptClaim = ReceiptScope & { id: string; claimToken: string };
export type ReceiptStore = {
  getSettings(scope: ReceiptScope): Promise<ReceiptSettings | null>;
  getJob(input: ReceiptScope & { paymentId: string }): Promise<ReceiptJob | null>;
  claim(input: { settings: ReceiptSettings; link: ReceiptLink; evidence: ReceiptEvidence }): Promise<ReceiptJob | null>;
  markPosting(input: ReceiptClaim & { settings: ReceiptSettings }): Promise<boolean>;
  markVerified(input: ReceiptClaim & { mutationId: number }): Promise<boolean>;
  markReview(input: ReceiptClaim & { errorCode: string }): Promise<boolean>;
  releasePrepared(input: ReceiptClaim): Promise<boolean>;
};

// Volatile PDF URLs and local verification timestamps are not invoice content.
export function receiptInvoiceSnapshot(invoice: EboekhoudenInvoice): EboekhoudenInvoice {
  return JSON.parse(JSON.stringify({
    id: invoice.id, invoiceNumber: invoice.invoiceNumber, reference: invoice.reference,
    date: invoice.date, relationId: invoice.relationId, termOfPayment: invoice.termOfPayment,
    totalAmount: invoice.totalAmount, totalExcl: invoice.totalExcl, vatAmount: invoice.vatAmount,
    inExVat: invoice.inExVat, items: invoice.items,
  })) as EboekhoudenInvoice;
}
