import { NextResponse } from "next/server";

import { requireViewerSession } from "@/lib/auth/session";
import { getMollieConnectConfig } from "@/lib/env";
import { consumeMollieOAuthState } from "@/lib/mollie/oauth-state";
import { REQUIRED_MOLLIE_CONNECT_SCOPES, upsertTenantMollieConnection } from "@/lib/mollie/tenant-connections";

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
};

function resultUrl(result: string) {
  return new URL(`/settings?mollieConnect=${result}`, process.env.APP_URL ?? "http://localhost:3000");
}

export async function GET(request: Request) {
  const session = await requireViewerSession();
  const url = new URL(request.url);
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  if (!state || !code || url.searchParams.get("error")) {
    return NextResponse.redirect(resultUrl("cancelled"));
  }

  try {
    const { tenantId } = await consumeMollieOAuthState({ state, actorEmail: session.user.email! });
    const config = getMollieConnectConfig();
    const basic = Buffer.from(`${config.MOLLIE_CONNECT_CLIENT_ID}:${config.MOLLIE_CONNECT_CLIENT_SECRET}`).toString("base64");
    const response = await fetch("https://api.mollie.com/oauth2/tokens", {
      method: "POST",
      headers: { Accept: "application/json", Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, grant_type: "authorization_code", redirect_uri: config.MOLLIE_CONNECT_REDIRECT_URI }),
      cache: "no-store",
    });
    if (!response.ok) return NextResponse.redirect(resultUrl("failed"));
    const token = (await response.json()) as TokenResponse;
    if (!token.access_token || !token.refresh_token) return NextResponse.redirect(resultUrl("failed"));
    const expiresAt = new Date(Date.now() + Math.max(1, token.expires_in ?? 3600) * 1000).toISOString();
    const grantedScopes = token.scope?.split(/\s+/).filter(Boolean) ?? [];
    const hasRequiredScopes = REQUIRED_MOLLIE_CONNECT_SCOPES.every((scope) => grantedScopes.includes(scope));
    await upsertTenantMollieConnection({
      tenantId,
      status: hasRequiredScopes ? "incomplete" : "reconnect_required",
      grantedScopes,
      refreshToken: token.refresh_token,
      accessToken: token.access_token,
      accessTokenExpiresAt: expiresAt,
      failureReasonCode: hasRequiredScopes ? "profile_selection_required" : "scope_missing",
    });
    return NextResponse.redirect(resultUrl(hasRequiredScopes ? "profile_required" : "scope_required"));
  } catch {
    return NextResponse.redirect(resultUrl("failed"));
  }
}
