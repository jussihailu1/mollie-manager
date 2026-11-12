import { isDeepStrictEqual } from "node:util";
import type { EboekhoudenInvoice, EboekhoudenLedger } from "./client";
import type { SalesMutation } from "./invoice-posting";
import { previewPaymentReceipt, type ReceiptLink, type ReceiptMutationInput, type ReceiptOutstanding, type ReceiptPayment } from "./payment-receipt-preview";
import { receiptInvoiceSnapshot, type ReceiptClaim, type ReceiptEvidence, type ReceiptJob, type ReceiptSettings, type ReceiptStore } from "./payment-receipt-contract";

export type ReceiptContext = {
  link: ReceiptLink;
  allLinks: ReceiptLink[];
  payment: ReceiptPayment;
  invoice: EboekhoudenInvoice;
  ledgers: EboekhoudenLedger[];
  mutations: SalesMutation[];
  outstanding: ReceiptOutstanding[];
};
export type ReceiptOutcome = {
  status: "posted" | "reconciled" | "already_verified" | "disabled" | "busy" | "review_required" | "failed";
  code?: string;
  mutationId?: number;
};
export type ReceiptWorkflowDependencies = {
  store: ReceiptStore;
  load(settings: ReceiptSettings, paymentId: string): Promise<ReceiptContext>;
  create(payload: ReceiptMutationInput, tenantId: string, beforeWrite: () => Promise<void>): Promise<{ id: number }>;
};

const evidenceMatches = (left: ReceiptEvidence, right: ReceiptEvidence) =>
  isDeepStrictEqual(left.payload, right.payload) && isDeepStrictEqual(left.invoiceSnapshot, right.invoiceSnapshot);
const sameConfiguration = (job: ReceiptJob, settings: ReceiptSettings) =>
  job.tenantId === settings.tenantId && job.mode === settings.mode && job.profileId === settings.profileId &&
  job.clearingLedgerId === settings.clearingLedgerId && Date.parse(job.credentialVersion) === Date.parse(settings.credentialVersion);

function inspect(settings: ReceiptSettings, context: ReceiptContext, paymentId: string) {
  if (context.link.paymentId !== paymentId || !Number.isFinite(Date.parse(settings.paymentsFrom)) ||
      Date.parse(context.link.paidAt) < Date.parse(settings.paymentsFrom) ||
      Date.parse(context.link.paidAt) > Date.now()) return null;
  return previewPaymentReceipt({ ...context, ...settings });
}

export async function runPaymentReceipt(
  input: { tenantId: string; mode: "live" | "test"; paymentId: string },
  dependencies: ReceiptWorkflowDependencies,
): Promise<ReceiptOutcome> {
  // A test Mollie payment must never write to a live accounting administration.
  if (input.mode !== "live") return { status: "disabled" };
  if (!input.tenantId || !input.paymentId) return { status: "review_required", code: "identity_missing" };
  const scope = { tenantId: input.tenantId, mode: "live" as const };
  const { store } = dependencies;
  let claim: ReceiptClaim | undefined;
  let attempted = false;
  try {
    const settings = await store.getSettings(scope);
    if (!settings?.enabled) return { status: "disabled" };
    if (settings.tenantId !== scope.tenantId || settings.mode !== "live") return { status: "review_required", code: "configuration_changed" };
    const existing = await store.getJob({ ...scope, paymentId: input.paymentId });
    if (existing && (!sameConfiguration(existing, settings) || existing.paymentId !== input.paymentId)) {
      return { status: "review_required", code: "configuration_changed" };
    }
    if (existing?.status === "verified") return { status: "already_verified", mutationId: existing.mutationId ?? undefined };

    const context = await dependencies.load(settings, input.paymentId);
    const preview = inspect(settings, context, input.paymentId);
    if (!preview || !("expectedMutation" in preview) || !preview.expectedMutation) {
      return { status: "review_required", code: "payment_or_invoice_requires_review" };
    }
    const evidence: ReceiptEvidence = { payload: preview.expectedMutation, invoiceSnapshot: receiptInvoiceSnapshot(context.invoice) };
    const job = await store.claim({ settings, link: context.link, evidence });
    if (!job?.claimToken) return { status: "busy" };
    claim = { ...scope, id: job.id, claimToken: job.claimToken };
    attempted = !!job.attemptedAt || job.status === "posting";
    const hold = async (code: string): Promise<ReceiptOutcome> => {
      if (!await store.markReview({ ...claim!, errorCode: code })) return { status: "failed", code: "claim_lost" };
      return { status: "review_required", code };
    };
    if (!sameConfiguration(job, settings) || job.paymentId !== input.paymentId ||
        job.invoiceId !== context.link.invoiceId || job.molliePaymentId !== context.link.molliePaymentId || !evidenceMatches(job, evidence)) {
      return await hold("frozen_evidence_changed");
    }

    // Repeat provider/local evidence after obtaining the lease. An overlapping
    // worker or manual payment may have settled the invoice since the first read.
    const fresh = await dependencies.load(settings, input.paymentId);
    const refreshed = inspect(settings, fresh, input.paymentId);
    if (!refreshed || !("expectedMutation" in refreshed) || !refreshed.expectedMutation ||
        !evidenceMatches(job, { payload: refreshed.expectedMutation, invoiceSnapshot: receiptInvoiceSnapshot(fresh.invoice) })) {
      return await hold("fresh_evidence_changed");
    }
    if (refreshed.status === "already_posted") {
      if (fresh.outstanding.some(item => item.invoiceNumber === job.payload.invoiceNumber)) return await hold("invoice_still_outstanding");
      if (!await store.markVerified({ ...claim, mutationId: refreshed.mutationId })) return { status: "failed", code: "verification_not_saved" };
      return { status: "reconciled", mutationId: refreshed.mutationId };
    }
    if (attempted || job.status !== "prepared") return await hold("uncertain_post_requires_review");
    if (refreshed.status !== "missing_receipt") return await hold("receipt_not_ready");

    const posted = await dependencies.create(job.payload, scope.tenantId, async () => {
      // The transport authenticates BEFORE this durable marker, then attempts
      // one POST only. Marking first covers process death and lost responses.
      if (!await store.markPosting({ ...claim!, settings })) throw new Error("Receipt claim/configuration changed");
      attempted = true;
    });
    if (!attempted || !Number.isSafeInteger(posted.id) || posted.id <= 0) throw new Error("Unverified receipt response");
    const saved = await dependencies.load(settings, input.paymentId);
    const verified = inspect(settings, saved, input.paymentId);
    if (!verified || verified.status !== "already_posted" || verified.mutationId !== posted.id ||
        !evidenceMatches(job, { payload: verified.expectedMutation, invoiceSnapshot: receiptInvoiceSnapshot(saved.invoice) }) ||
        saved.outstanding.some(item => item.invoiceNumber === job.payload.invoiceNumber)) {
      return await hold("saved_receipt_requires_review");
    }
    if (!await store.markVerified({ ...claim, mutationId: posted.id })) return { status: "failed", code: "verification_not_saved" };
    return { status: "posted", mutationId: posted.id };
  } catch {
    // Only fixed codes are stored/returned; no provider errors, secrets or PII.
    if (claim) {
      try {
        if (attempted) await store.markReview({ ...claim, errorCode: "post_outcome_unverified" });
        else await store.releasePrepared(claim);
      } catch { /* Durable posting marker survives a DB outage. */ }
    }
    return { status: attempted ? "review_required" : "failed", code: attempted ? "post_outcome_unverified" : "preflight_unavailable" };
  }
}
