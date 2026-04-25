import { PaymentsWorkspace } from "@/components/payments-workspace";
import { getSelectedMollieMode } from "@/lib/dashboard-mode";
import { getSingleSearchParam } from "@/lib/format";
import { listCustomers, listPayments } from "@/lib/onboarding/data";
import { toUiCustomerRecord, toUiPaymentRecord } from "@/lib/ui-data";

export default async function PaymentsPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  const selectedMode = await getSelectedMollieMode();
  const [resolvedSearchParams, customersResult, paymentsResult] = await Promise.all([
    searchParams,
    listCustomers({ mode: selectedMode }),
    listPayments({ mode: selectedMode }),
  ]);

  return (
    <PaymentsWorkspace
      key={[
        getSingleSearchParam(resolvedSearchParams.focus) ?? "",
        getSingleSearchParam(resolvedSearchParams.notice) ?? "",
        getSingleSearchParam(resolvedSearchParams.error) ?? "",
      ].join(":")}
      customers={customersResult.map(toUiCustomerRecord)}
      error={getSingleSearchParam(resolvedSearchParams.error) ?? null}
      initialFocusId={getSingleSearchParam(resolvedSearchParams.focus) ?? null}
      notice={getSingleSearchParam(resolvedSearchParams.notice) ?? null}
      payments={paymentsResult.map(toUiPaymentRecord)}
    />
  );
}
