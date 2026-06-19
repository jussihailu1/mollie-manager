import type {
  DeliveryInput,
  InvoiceActor,
  RetryDeliveryCandidate,
} from "@/lib/invoice-delivery-batch";

import type { CustomerInvoiceOwnerType } from "@/lib/customer-invoice-resend";
import type { DashboardModeFilter } from "@/lib/dashboard-mode";

export type CustomerInvoiceResendTargetInput = {
  customerId: string;
  mode: DashboardModeFilter;
  ownerId: string;
  ownerType: CustomerInvoiceOwnerType;
};

type ResendTarget = RetryDeliveryCandidate;

export type CustomerInvoiceResendDependencies = {
  deliverCustomerInvoiceEmail: (
    input: DeliveryInput,
  ) => Promise<{ status: "failed" | "sent" | "skipped" }>;
  loadTarget: (input: CustomerInvoiceResendTargetInput) => Promise<ResendTarget | null>;
};

export async function resendCustomerInvoiceEmailWithDependencies(
  input: CustomerInvoiceResendTargetInput & {
    actor: InvoiceActor;
  },
  dependencies: CustomerInvoiceResendDependencies,
) {
  const target = await dependencies.loadTarget(input);

  if (!target) {
    return { status: "not_found" as const };
  }

  const delivery = await dependencies.deliverCustomerInvoiceEmail({
    actor: input.actor,
    ...target,
  });

  return { status: delivery.status };
}
