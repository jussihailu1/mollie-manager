import { type NextRequest } from "next/server";

import { requireViewerSession } from "@/lib/auth/session";
import { getSelectedMollieMode } from "@/lib/dashboard-mode";
import { getLatestConsentLinkUrl } from "@/lib/onboarding/data";

export async function GET(request: NextRequest) {
  await requireViewerSession();

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
  const latestConsentUrl = await getLatestConsentLinkUrl(customerId, mode);

  return Response.json({
    latestConsentUrl,
  });
}
