import { NextResponse } from "next/server";

import { getMollieConnectConfig } from "@/lib/env";
import { createMollieOAuthState } from "@/lib/mollie/oauth-state";
import { REQUIRED_MOLLIE_CONNECT_SCOPES } from "@/lib/mollie/tenant-connections";
import { getCurrentTenantSelectionForViewer } from "@/lib/tenant-context";

export async function GET() {
  const { currentTenant, session } = await getCurrentTenantSelectionForViewer();
  const config = getMollieConnectConfig();
  const state = await createMollieOAuthState({
    tenantId: currentTenant.id,
    actorEmail: session.user.email!,
  });
  const url = new URL("https://my.mollie.com/oauth2/authorize");
  url.searchParams.set("client_id", config.MOLLIE_CONNECT_CLIENT_ID);
  url.searchParams.set("redirect_uri", config.MOLLIE_CONNECT_REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", REQUIRED_MOLLIE_CONNECT_SCOPES.join(" "));
  url.searchParams.set("state", state);
  return NextResponse.redirect(url);
}
