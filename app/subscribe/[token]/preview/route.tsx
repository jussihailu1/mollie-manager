import { ImageResponse } from "next/og";

import { getConsentLinkPresentationByToken } from "@/lib/consent-link-presentation";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const details = await getConsentLinkPresentationByToken(token);
  const issuerName = details?.issuerName || "Subscription confirmation";

  return new ImageResponse(
    (
      <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", padding: 72, background: "#f5f5f0", color: "#162d27", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", fontSize: 28, color: "#406759" }}>
          SUBSCRIPTION CONFIRMATION
        </div>
        <div style={{ display: "flex", flex: 1, alignItems: "center", fontSize: issuerName.length > 50 ? 48 : 64, fontWeight: 700, lineHeight: 1.15 }}>
          {details ? issuerName : "Subscription link unavailable"}
        </div>
        <div style={{ display: "flex", borderTop: "2px solid #cbd6cc", paddingTop: 28, fontSize: 30 }}>
          {details ? "Review your subscription and confirm the terms" : "Please ask the business for a new link"}
        </div>
      </div>
    ),
    { width: 1200, height: 630, headers: { "Cache-Control": "private, no-store" } },
  );
}
