import type { ReactNode } from "react";

import { OperationsShell } from "@/components/operations-shell";
import { getSelectedMollieMode } from "@/lib/dashboard-mode";
import { env } from "@/lib/env";
import { listAlertInbox } from "@/lib/reliability/data";
import { getCurrentTenantSelectionForViewer } from "@/lib/tenant-context";
import { toUiNotificationRecord } from "@/lib/ui-data";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  const { currentTenant, session, accessibleTenants } =
    await getCurrentTenantSelectionForViewer();
  const selectedMode = await getSelectedMollieMode();
  const recentAlerts = (await listAlertInbox({
    mode: selectedMode,
    tenantId: currentTenant.id,
  }))
    .slice(0, 8)
    .map(toUiNotificationRecord);

  return (
    <OperationsShell
      accessibleTenants={accessibleTenants}
      isLiveModeDisabled={env.APP_ENV === "test"}
      recentAlerts={recentAlerts}
      currentTenant={currentTenant}
      selectedMode={selectedMode}
      userEmail={session.user.email ?? ""}
      userName={session.user.name ?? null}
    >
      {children}
    </OperationsShell>
  );
}
