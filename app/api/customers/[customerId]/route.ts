import { getSelectedMollieMode } from "@/lib/dashboard-mode";
import { getCustomerDetail } from "@/lib/onboarding/data";
import { getCurrentTenantSelectionForViewer } from "@/lib/tenant-context";
import { toUiCustomerRecord } from "@/lib/ui-data";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ customerId: string }> },
) {
  const { currentTenant } = await getCurrentTenantSelectionForViewer();
  const { customerId } = await params;
  const selectedMode = await getSelectedMollieMode();
  const detail = await getCustomerDetail(customerId, selectedMode, currentTenant.id);

  if (!detail) {
    return Response.json({ error: "Customer not found." }, { status: 404 });
  }

  return Response.json({ customer: toUiCustomerRecord(detail.customer) }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
