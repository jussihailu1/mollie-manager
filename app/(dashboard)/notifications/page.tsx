import { NotificationsWorkspace } from "@/components/notifications-workspace";
import { getSelectedMollieMode } from "@/lib/dashboard-mode";
import { getSingleSearchParam } from "@/lib/format";
import { listOperationalAlerts } from "@/lib/onboarding/data";
import { listAlertInbox } from "@/lib/reliability/data";
import { toUiAttentionRecord, toUiNotificationRecord } from "@/lib/ui-data";

export default async function NotificationsPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  const selectedMode = await getSelectedMollieMode();
  const [resolvedSearchParams, alertsResult, attentionResult] = await Promise.all([
    searchParams,
    listAlertInbox({ mode: selectedMode }),
    listOperationalAlerts({ mode: selectedMode }),
  ]);

  return (
    <NotificationsWorkspace
      alerts={alertsResult.map(toUiNotificationRecord)}
      attentionAlerts={attentionResult.map(toUiAttentionRecord)}
      error={getSingleSearchParam(resolvedSearchParams.error) ?? null}
      notice={getSingleSearchParam(resolvedSearchParams.notice) ?? null}
    />
  );
}
