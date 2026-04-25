import { CustomersWorkspace } from "@/components/customers-workspace";
import { getSelectedMollieMode } from "@/lib/dashboard-mode";
import { getSingleSearchParam } from "@/lib/format";
import { listCustomers } from "@/lib/onboarding/data";
import { toUiCustomerRecord } from "@/lib/ui-data";

export default async function CustomersPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  const selectedMode = await getSelectedMollieMode();
  const [resolvedSearchParams, customersResult] = await Promise.all([
    searchParams,
    listCustomers({ mode: selectedMode }),
  ]);

  return (
    <CustomersWorkspace
      key={[
        getSingleSearchParam(resolvedSearchParams.focus) ?? "",
        getSingleSearchParam(resolvedSearchParams.notice) ?? "",
        getSingleSearchParam(resolvedSearchParams.error) ?? "",
      ].join(":")}
      customers={customersResult.map(toUiCustomerRecord)}
      error={getSingleSearchParam(resolvedSearchParams.error) ?? null}
      initialFocusId={getSingleSearchParam(resolvedSearchParams.focus) ?? null}
      notice={getSingleSearchParam(resolvedSearchParams.notice) ?? null}
    />
  );
}
