import type { MollieMode } from "@/lib/env";
import { type SyncActor } from "@/lib/reliability/sync-persistence";

export type FirstPaymentInvoiceDeliveryInput = {
  actor: SyncActor;
  customerEmail: string | null;
  customerId: string | null;
  entityId: string;
  invoiceDocumentUrl: string | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
  mode: MollieMode;
  subscriptionId: string | null;
  tenantId: string;
};

export function buildFirstPaymentInvoiceDelivery(input: FirstPaymentInvoiceDeliveryInput) {
  return {
    actor: input.actor,
    customerEmail: input.customerEmail,
    customerId: input.customerId,
    entityId: input.entityId,
    invoiceDocumentUrl: input.invoiceDocumentUrl,
    invoiceId: input.invoiceId,
    invoiceNumber: input.invoiceNumber,
    invoiceProvider: "eboekhouden" as const,
    invoiceType: "first_payment" as const,
    mode: input.mode,
    subscriptionId: input.subscriptionId,
    tenantId: input.tenantId,
  };
}
