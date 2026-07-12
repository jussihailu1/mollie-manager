import { NotificationsWorkspace } from "@/components/notifications-workspace";
import { getSelectedMollieMode } from "@/lib/dashboard-mode";
import { getSingleSearchParam } from "@/lib/format";
import { listPendingSubscriptionOperationRequests } from "@/lib/pending-subscription-operation-requests";
import { getCurrentTenantSelectionForViewer } from "@/lib/tenant-context";
import { listAlertInbox } from "@/lib/reliability/data";
import { listNeedsAttentionItems } from "@/lib/reliability/needs-attention";
import { listPaymentFollowUpQueue } from "@/lib/payment-follow-up-queue";
import { toUiAttentionRecord, toUiNotificationRecord } from "@/lib/ui-data";

export default async function NotificationsPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  const { currentTenant } = await getCurrentTenantSelectionForViewer();
  const selectedMode = await getSelectedMollieMode();
  const tenantId = currentTenant.id;
  const [
    resolvedSearchParams,
    alertsResult,
    attentionResult,
    followUpResult,
    operationRequestResult,
  ] = await Promise.all([
    searchParams,
    listAlertInbox({ mode: selectedMode, tenantId }),
    listNeedsAttentionItems({ mode: selectedMode, tenantId }),
    listPaymentFollowUpQueue({ mode: selectedMode, tenantId }),
    listPendingSubscriptionOperationRequests({ mode: selectedMode, tenantId }),
  ]);

  return (
    <NotificationsWorkspace
      alerts={alertsResult.map(toUiNotificationRecord)}
      attentionAlerts={attentionResult.map(toUiAttentionRecord)}
      error={getSingleSearchParam(resolvedSearchParams.error) ?? null}
      notice={getSingleSearchParam(resolvedSearchParams.notice) ?? null}
      paymentFollowUps={followUpResult}
      pendingOperationRequests={operationRequestResult}
    />
  );
}
