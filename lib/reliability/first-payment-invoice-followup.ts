import { writeAuditLog } from "@/lib/audit";
import type { MollieMode } from "@/lib/env";
import { createEboekhoudenInvoiceForFirstPayment } from "@/lib/eboekhouden/first-payment-invoices";
import type { SyncActor } from "@/lib/reliability/sync-persistence";

export async function runFirstPaymentInvoiceCreationFollowUp(input: {
  actor: SyncActor;
  failureSummary: string;
  mode: MollieMode;
  paymentId: string;
  tenantId: string;
}) {
  try {
    await createEboekhoudenInvoiceForFirstPayment(input.paymentId, {
      actor: input.actor,
      tenantId: input.tenantId,
    });
  } catch (error) {
    await writeAuditLog(
      {
        action: "first_payment_invoice.auto_create",
        details: {
          error: error instanceof Error ? error.message : String(error),
          paymentId: input.paymentId,
        },
        entityId: input.paymentId,
        entityType: "payment",
        mode: input.mode,
        outcome: "failure",
        summary: input.failureSummary,
      },
      undefined,
      input.actor,
    );
  }
}
