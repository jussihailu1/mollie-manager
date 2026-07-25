import { notFound } from "next/navigation";

import { CustomersWorkspace } from "@/components/customers-workspace";
import { getSelectedMollieMode } from "@/lib/dashboard-mode";
import { getSingleSearchParam } from "@/lib/format";
import { listCustomers } from "@/lib/onboarding/data";
import { getCurrentTenantSelectionForViewer } from "@/lib/tenant-context";
import { toUiCustomerRecord } from "@/lib/ui-data";
import { hasTenantEboekhoudenCredentials } from "@/lib/eboekhouden/tenant-credentials";

type CustomerPageSearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function CustomerPageContent({
  customerId,
  searchParams,
}: Readonly<{
  customerId?: string;
  searchParams: CustomerPageSearchParams;
}>) {
  const { currentTenant } = await getCurrentTenantSelectionForViewer();
  const selectedMode = await getSelectedMollieMode();
  const tenantId = currentTenant.id;
  const [resolvedSearchParams, customersResult, archivedCustomersResult, hasEboekhoudenConnection] = await Promise.all([
    searchParams,
    listCustomers({ mode: selectedMode, tenantId }),
    listCustomers({ archived: true, mode: selectedMode, tenantId }),
    hasTenantEboekhoudenCredentials(tenantId),
  ]);

  if ("focus" in resolvedSearchParams) {
    notFound();
  }

  const customers = customersResult.map(toUiCustomerRecord);
  const archivedCustomers = archivedCustomersResult.map(toUiCustomerRecord);

  if (customerId && ![...customers, ...archivedCustomers].some((customer) => customer.id === customerId)) {
    notFound();
  }

  return (
    <CustomersWorkspace
      key={[
        customerId ?? "",
        getSingleSearchParam(resolvedSearchParams.view) ?? "",
      ].join(":")}
      archivedCustomers={archivedCustomers}
      customers={customers}
      hasEboekhoudenConnection={hasEboekhoudenConnection}
      initialDrawerId={customerId ?? null}
      initialView={getSingleSearchParam(resolvedSearchParams.view) ?? "all"}
    />
  );
}
