import type { MollieMode } from "@/lib/env";
import {
  normalizeFirstPaymentInvoiceStates,
} from "@/lib/eboekhouden/first-payment-invoice-queue";
import { runFirstPaymentInvoiceCreationFollowUp } from "@/lib/reliability/first-payment-invoice-followup";
import {
  shouldRunBillingFollowups,
  type ReconciliationMode,
} from "@/lib/reliability/reconciliation-mode";
import type { SyncActor } from "@/lib/reliability/sync-persistence";

export async function runFirstPaymentInvoiceSyncFollowUp(input: {
  actor: SyncActor;
  failureSummary: string;
  isPaid: boolean;
  mode: MollieMode;
  paymentId: string;
  reconciliationMode: ReconciliationMode;
  tenantId: string;
}) {
  await normalizeFirstPaymentInvoiceStates({
    mode: input.mode,
    paymentId: input.paymentId,
    tenantId: input.tenantId,
  });

  if (!input.isPaid || !shouldRunBillingFollowups(input.reconciliationMode)) {
    return;
  }

  await runFirstPaymentInvoiceCreationFollowUp({
    actor: input.actor,
    failureSummary: input.failureSummary,
    mode: input.mode,
    paymentId: input.paymentId,
    tenantId: input.tenantId,
  });
}
