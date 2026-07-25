import { notFound } from "next/navigation";

import { PaymentsWorkspace } from "@/components/payments-workspace";
import { getSelectedMollieMode } from "@/lib/dashboard-mode";
import { getSingleSearchParam } from "@/lib/format";
import { listCustomers, listPayments } from "@/lib/onboarding/data";
import { getCurrentTenantSelectionForViewer } from "@/lib/tenant-context";
import { toUiCustomerRecord, toUiPaymentRecord } from "@/lib/ui-data";

type PaymentPageSearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function PaymentPageContent({
  paymentId,
  searchParams,
}: Readonly<{
  paymentId?: string;
  searchParams: PaymentPageSearchParams;
}>) {
  const { currentTenant } = await getCurrentTenantSelectionForViewer();
  const selectedMode = await getSelectedMollieMode();
  const tenantId = currentTenant.id;
  const [resolvedSearchParams, customersResult, paymentsResult] = await Promise.all([
    searchParams,
    listCustomers({ mode: selectedMode, tenantId }),
    listPayments({ mode: selectedMode, tenantId }),
  ]);

  if ("focus" in resolvedSearchParams) {
    notFound();
  }

  const payments = paymentsResult.map(toUiPaymentRecord);

  if (paymentId && !payments.some((payment) => payment.id === paymentId)) {
    notFound();
  }

  return (
    <PaymentsWorkspace
      key={[
        paymentId ?? "",
        getSingleSearchParam(resolvedSearchParams.customerId) ?? "",
      ].join(":")}
      customers={customersResult.map(toUiCustomerRecord)}
      initialCustomerId={getSingleSearchParam(resolvedSearchParams.customerId) ?? null}
      initialDrawerId={paymentId ?? null}
      payments={payments}
    />
  );
}
