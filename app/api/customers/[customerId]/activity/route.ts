import { type NextRequest } from "next/server";

import { requireViewerSession } from "@/lib/auth/session";
import { listCustomerActivityTimeline } from "@/lib/customer-activity-timeline";
import { listCustomerNotificationHistory } from "@/lib/customer-notification-history";
import { getSelectedMollieMode } from "@/lib/dashboard-mode";
import { getCustomerDetail } from "@/lib/onboarding/data";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ customerId: string }> },
) {
  await requireViewerSession();

  const { customerId } = await params;
  const selectedMode = await getSelectedMollieMode();
  const detail = await getCustomerDetail(customerId, selectedMode);

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

  const [items, notifications] = await Promise.all([
    listCustomerActivityTimeline({
      customerId,
      limit: 30,
      mode: selectedMode,
    }),
    listCustomerNotificationHistory({
      customerId,
      limit: 25,
      mode: selectedMode,
    }),
  ]);

  return Response.json({ items, notifications });
}
