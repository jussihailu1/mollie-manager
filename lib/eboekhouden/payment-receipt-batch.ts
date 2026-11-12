import "server-only";
import { createEboekhoudenPaymentReceipt } from "./client";
import { advanceReceiptCursor, receiptStore } from "./payment-receipt-persistence";
import { listReceiptLinks, listUnverifiedReceiptPaymentIds, loadReceiptContext } from "./payment-receipt-runtime";
import { runPaymentReceipt } from "./payment-receipt-workflow";

export function emptyReceiptBatch() {
  return { checkedCount: 0, postedCount: 0, reconciledCount: 0, reviewRequiredCount: 0,
    failedCount: 0, busyCount: 0, remainingCount: 0, disabled: true };
}

export async function processPaymentReceiptsBatch(input: { tenantId: string; mode: "live" | "test"; limit: number }) {
  const result = emptyReceiptBatch();
  // Before touching the new tables: existing deployments remain safe until the
  // isolated receipt migration and tenant mapping have been reviewed/applied.
  if (process.env.EBOEKHOUDEN_RECEIPT_AUTOMATION_ENABLED !== "true" || input.mode !== "live") return result;
  if (!input.tenantId) throw new Error("Explicit tenant context required");
  const scope = { tenantId: input.tenantId, mode: "live" as const };
  const settings = await receiptStore.getSettings(scope);
  if (!settings?.enabled) return result;
  if (settings.tenantId !== scope.tenantId || settings.mode !== scope.mode) throw new Error("Receipt configuration scope differs");
  result.disabled = false;
  const [links, jobs] = await Promise.all([listReceiptLinks(scope), listUnverifiedReceiptPaymentIds(scope)]);
  if (links.some(link => link.tenantId !== scope.tenantId || link.mode !== scope.mode)) throw new Error("Receipt candidate scope differs");
  const completed = new Set(jobs.filter(job => job.status === "verified").map(job => job.paymentId));
  // Durable unfinished claims remain visible even if their payment is reversed,
  // the invoice is voided, or a local ownership link disappears.
  const candidates = [...new Set([
    ...jobs.filter(job => job.status !== "verified").map(job => job.paymentId),
    ...links.filter(link => link.status === "paid" && Date.parse(link.paidAt) >= Date.parse(settings.paymentsFrom) &&
      !completed.has(link.paymentId)).map(link => link.paymentId),
  ])].sort();
  const cursor = settings.cursorPaymentId ?? "";
  const ordered = [...candidates.filter(id => id > cursor), ...candidates.filter(id => id <= cursor)];
  const limit = Number.isFinite(input.limit) ? Math.max(1, Math.min(Math.trunc(input.limit), 5)) : 5;
  // A durable round-robin cursor advances after every outcome, including holds,
  // so neither new blocked candidates nor old uncertain work can starve others.
  result.remainingCount = Math.max(0, candidates.length - limit);
  for (const paymentId of ordered.slice(0, limit)) {
    const outcome = await runPaymentReceipt({ ...scope, paymentId }, {
      store: receiptStore, load: loadReceiptContext, create: createEboekhoudenPaymentReceipt,
    });
    result.checkedCount++;
    if (outcome.status === "posted") result.postedCount++;
    else if (outcome.status === "reconciled" || outcome.status === "already_verified") result.reconciledCount++;
    else if (outcome.status === "review_required") result.reviewRequiredCount++;
    else if (outcome.status === "failed") result.failedCount++;
    else if (outcome.status === "busy") result.busyCount++;
    else result.disabled = true;
    try { await advanceReceiptCursor(settings, paymentId); }
    catch {
      // Preserve successes already observed if scheduling persistence fails.
      result.failedCount++;
      result.remainingCount = candidates.length - result.checkedCount;
      break;
    }
  }
  return result;
}
