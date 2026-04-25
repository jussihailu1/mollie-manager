import type { ReactNode } from "react";

import { OperationsShell } from "@/components/operations-shell";
import { requireViewerSession } from "@/lib/auth/session";
import { getSelectedMollieMode } from "@/lib/dashboard-mode";
import { listAlertInbox } from "@/lib/reliability/data";
import { toUiNotificationRecord } from "@/lib/ui-data";

export default async function DashboardLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  await requireViewerSession();
  const selectedMode = await getSelectedMollieMode();
  const recentAlerts = (await listAlertInbox({ mode: selectedMode }))
    .slice(0, 8)
    .map(toUiNotificationRecord);

  return (
    <OperationsShell recentAlerts={recentAlerts} selectedMode={selectedMode}>
      {children}
    </OperationsShell>
  );
}
