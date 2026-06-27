import "server-only";

import { cookies } from "next/headers";

import { requireViewerSession } from "@/lib/auth/session";
import { tenantSelectionCookieName } from "@/lib/tenant-selection";
import {
  requireTenantAccessForOperatorEmail,
  resolveTenantSelectionForOperatorEmail,
} from "@/lib/tenants";

export async function getCurrentTenantSelectionForViewer() {
  const session = await requireViewerSession();
  await requireTenantAccessForOperatorEmail(session.user.email);
  const cookieStore = await cookies();

  return {
    session,
    ...(await resolveTenantSelectionForOperatorEmail(
      session.user.email,
      cookieStore.get(tenantSelectionCookieName)?.value ?? null,
    )),
  };
}
