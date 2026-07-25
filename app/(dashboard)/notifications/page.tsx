import { NotificationsWorkspace } from "@/components/notifications-workspace";
import { getSelectedMollieMode } from "@/lib/dashboard-mode";
import { listPendingSubscriptionOperationRequests } from "@/lib/pending-subscription-operation-requests";
import { getCurrentTenantSelectionForViewer } from "@/lib/tenant-context";
import { listAlertInbox } from "@/lib/reliability/data";
import { listNeedsAttentionItems } from "@/lib/reliability/needs-attention";
import { listPaymentFollowUpQueue } from "@/lib/payment-follow-up-queue";
import { toUiAttentionRecord, toUiNotificationRecord } from "@/lib/ui-data";

export default async function NotificationsPage() {
  const { currentTenant } = await getCurrentTenantSelectionForViewer();
  const selectedMode = await getSelectedMollieMode();
  const tenantId = currentTenant.id;
  const [
    alertsResult,
    attentionResult,
    followUpResult,
    operationRequestResult,
  ] = await Promise.all([
    listAlertInbox({ mode: selectedMode, tenantId }),
    listNeedsAttentionItems({ mode: selectedMode, tenantId }),
    listPaymentFollowUpQueue({ mode: selectedMode, tenantId }),
    listPendingSubscriptionOperationRequests({ mode: selectedMode, tenantId }),
  ]);

  return (
    <NotificationsWorkspace
      alerts={alertsResult.map(toUiNotificationRecord)}
      attentionAlerts={attentionResult.map(toUiAttentionRecord)}
      paymentFollowUps={followUpResult}
      pendingOperationRequests={operationRequestResult}
    />
  );
}
