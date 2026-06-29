import type { MollieMode } from "@/lib/env";
import { type SyncActor } from "@/lib/reliability/sync-persistence";

export type FirstPaymentInvoiceDeliveryInput = {
  actor: SyncActor;
  customerEmail: string | null;
  customerId: string | null;
  eboekhoudenInvoiceId: string | null;
  eboekhoudenInvoiceNumber: string | null;
  eboekhoudenInvoicePdfUrl: string | null;
  entityId: string;
  mode: MollieMode;
  subscriptionId: string | null;
  tenantId: string;
};

export function buildFirstPaymentInvoiceDelivery(input: FirstPaymentInvoiceDeliveryInput) {
  return {
    actor: input.actor,
    customerEmail: input.customerEmail,
    customerId: input.customerId,
    eboekhoudenInvoiceId: input.eboekhoudenInvoiceId,
    eboekhoudenInvoiceNumber: input.eboekhoudenInvoiceNumber,
    eboekhoudenInvoicePdfUrl: input.eboekhoudenInvoicePdfUrl,
    entityId: input.entityId,
    invoiceType: "first_payment" as const,
    mode: input.mode,
    subscriptionId: input.subscriptionId,
    tenantId: input.tenantId,
  };
}
