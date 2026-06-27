import type { ReactNode } from "react";
import { cookies } from "next/headers";

import { OperationsShell } from "@/components/operations-shell";
import { requireViewerSession } from "@/lib/auth/session";
import { getSelectedMollieMode } from "@/lib/dashboard-mode";
import { env } from "@/lib/env";
import { listAlertInbox } from "@/lib/reliability/data";
import { tenantSelectionCookieName } from "@/lib/tenant-selection";
import { toUiNotificationRecord } from "@/lib/ui-data";
import {
  requireTenantAccessForOperatorEmail,
  resolveTenantSelectionForOperatorEmail,
} from "@/lib/tenants";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  const session = await requireViewerSession();
  await requireTenantAccessForOperatorEmail(session.user.email);
  const cookieStore = await cookies();
  const tenantSelection = await resolveTenantSelectionForOperatorEmail(
    session.user.email,
    cookieStore.get(tenantSelectionCookieName)?.value ?? null,
  );
  const selectedMode = await getSelectedMollieMode();
  const recentAlerts = (await listAlertInbox({ mode: selectedMode }))
    .slice(0, 8)
    .map(toUiNotificationRecord);

  return (
    <OperationsShell
      accessibleTenants={tenantSelection.accessibleTenants}
      isLiveModeDisabled={env.APP_ENV === "test"}
      recentAlerts={recentAlerts}
      currentTenant={tenantSelection.currentTenant}
      selectedMode={selectedMode}
      userEmail={session.user.email ?? ""}
      userName={session.user.name ?? null}
    >
      {children}
    </OperationsShell>
  );
}
