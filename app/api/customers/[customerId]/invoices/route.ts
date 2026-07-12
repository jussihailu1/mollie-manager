import { type NextRequest } from "next/server";

import { listCustomerInvoiceLinks } from "@/lib/customer-invoice-links";
import { getSelectedMollieMode } from "@/lib/dashboard-mode";
import { getCustomerDetail } from "@/lib/onboarding/data";
import { getCurrentTenantSelectionForViewer } from "@/lib/tenant-context";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ customerId: string }> },
) {
  const { currentTenant } = await getCurrentTenantSelectionForViewer();

  const { customerId } = await params;
  const selectedMode = await getSelectedMollieMode();
  const tenantId = currentTenant.id;
  const detail = await getCustomerDetail(customerId, selectedMode, tenantId);

  if (!detail) {
    return Response.json(
      {
        error: "Customer not found.",
      },
      {
        status: 404,
      },
    );
  }

  const invoices = await listCustomerInvoiceLinks({
    customerId,
    limit: 20,
    mode: selectedMode,
    tenantId,
  });

  return Response.json({ invoices });
}
