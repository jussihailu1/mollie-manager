import { type NextRequest } from "next/server";

import { listCustomerActivityTimeline } from "@/lib/customer-activity-timeline";
import { listCustomerNotificationHistory } from "@/lib/customer-notification-history";
import { getSelectedMollieMode } from "@/lib/dashboard-mode";
import { getCustomerDetail } from "@/lib/onboarding/data";
import { listPendingSubscriptionOperationRequests } from "@/lib/pending-subscription-operation-requests";
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

  const [items, notifications, operationRequests] = await Promise.all([
    listCustomerActivityTimeline({
      customerId,
      limit: 30,
      mode: selectedMode,
      tenantId,
    }),
    listCustomerNotificationHistory({
      customerId,
      limit: 25,
      mode: selectedMode,
      tenantId,
    }),
    listPendingSubscriptionOperationRequests({
      customerId,
      limit: 10,
      mode: selectedMode,
      tenantId,
    }),
  ]);

  return Response.json({ items, notifications, operationRequests });
}
