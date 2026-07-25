import { type NextRequest } from "next/server";

import { getSelectedMollieMode } from "@/lib/dashboard-mode";
import { getLatestConsentLinkUrl } from "@/lib/onboarding/data";
import { getPendingConsentLink } from "@/lib/onboarding/pending-consent-link";
import { getCurrentTenantSelectionForViewer } from "@/lib/tenant-context";

export async function GET(request: NextRequest) {
  const { currentTenant } = await getCurrentTenantSelectionForViewer();

  const customerId = request.nextUrl.searchParams.get("customerId")?.trim() ?? "";
  if (!customerId) {
    return Response.json(
      {
        error: "Provide a customer id.",
      },
      { status: 400 },
    );
  }

  const mode = await getSelectedMollieMode();
  const [latestConsentUrl, pendingConsentLink] = await Promise.all([
    getLatestConsentLinkUrl(
    customerId,
    mode,
    currentTenant.id,
    ),
    getPendingConsentLink(customerId, mode, currentTenant.id),
  ]);

  return Response.json({
    latestConsentUrl,
    pendingConsentLink,
  });
}
