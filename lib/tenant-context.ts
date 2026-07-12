import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { requireViewerSession } from "@/lib/auth/session";
import { tenantSelectionCookieName } from "@/lib/tenant-selection";
import {
  requireTenantAccessForOperatorEmail,
  resolveTenantSelectionForOperatorEmail,
} from "@/lib/tenants";

export async function getCurrentTenantSelectionForViewer() {
  const session = await requireViewerSession();
  try {
    await requireTenantAccessForOperatorEmail(session.user.email);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "Tenant membership is required for operator access."
    ) {
      redirect("/login?error=AccessDenied");
    }

    throw error;
  }
  const cookieStore = await cookies();

  return {
    session,
    ...(await resolveTenantSelectionForOperatorEmail(
      session.user.email,
      cookieStore.get(tenantSelectionCookieName)?.value ?? null,
    )),
  };
}
