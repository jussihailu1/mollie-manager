import { type NextRequest } from "next/server";

import { getSelectedMollieMode } from "@/lib/dashboard-mode";
import { getCustomerDetail } from "@/lib/onboarding/data";
import { getCurrentTenantSelectionForViewer } from "@/lib/tenant-context";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ customerId: string }> },
) {
  const { currentTenant } = await getCurrentTenantSelectionForViewer();
  const tenantId = currentTenant.id;

  const { customerId } = await params;
  const selectedMode = await getSelectedMollieMode();
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

  return Response.json({
    mandates: detail.mandates,
    paymentLinks: detail.paymentLinks,
    payments: detail.payments,
    subscriptions: detail.subscriptions,
  });
}
