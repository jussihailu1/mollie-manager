import { type NextRequest } from "next/server";

import { getCustomerBillingProfile } from "@/lib/invoicing/customer-billing-profile";
import { getSelectedMollieMode } from "@/lib/dashboard-mode";
import { getCustomerDetail } from "@/lib/onboarding/data";
import { getCurrentTenantSelectionForViewer } from "@/lib/tenant-context";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ customerId: string }> },
) {
  const { customerId } = await params;
  const { currentTenant } = await getCurrentTenantSelectionForViewer();
  const mode = await getSelectedMollieMode();
  const customer = await getCustomerDetail(customerId, mode, currentTenant.id);

  if (!customer) {
    return Response.json({ error: "Customer not found." }, { status: 404 });
  }

  const profile = await getCustomerBillingProfile({
    customerId,
    tenantId: currentTenant.id,
  });

  return Response.json({ profile });
}
