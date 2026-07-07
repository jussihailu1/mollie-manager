import Link from "next/link";
import { RefreshCw } from "lucide-react";

import { BillingSettingsForm } from "@/app/(dashboard)/settings/billing-settings-form";
import { DeveloperSettingsToggle } from "@/app/(dashboard)/settings/developer-settings-toggle";
import { RetentionPolicyCard } from "@/app/(dashboard)/settings/retention-policy-card";
import { InlineNotice } from "@/components/inline-notice";
import {
  createDueFirstPaymentInvoicesAction,
  createDueRecurringInvoicesAction,
  queueFailedFirstPaymentInvoiceRetriesAction,
  queueFailedRecurringInvoiceRetriesAction,
} from "@/lib/billing-actions";
import {
  replayWebhookEventAction,
  repairReliabilityTargetAction,
  runReconciliationAction,
  sendTestAlertAction,
} from "@/lib/reliability/actions";
import {
  billingSettingsAreComplete,
  discoverEboekhoudenBillingSettings,
  ensureTenantBillingSettings,
} from "@/lib/billing-settings";
import { getSelectedMollieMode } from "@/lib/dashboard-mode";
import {
  getDueFirstPaymentInvoiceQueueSummary,
  getFailedFirstPaymentInvoiceRetrySummary,
} from "@/lib/eboekhouden/first-payment-invoices";
import {
  getDueRecurringInvoiceQueueSummary,
  getFailedRecurringInvoiceRetrySummary,
} from "@/lib/eboekhouden/recurring-invoices";
import { formatDateTime, formatLabel, getSingleSearchParam } from "@/lib/format";
import {
  listFailedWebhookEvents,
  listRecentAuditActivity,
} from "@/lib/reliability/data";
import { getReliabilityOpsSnapshot } from "@/lib/reliability/ops-snapshot";
import { getCurrentTenantSelectionForViewer } from "@/lib/tenant-context";
import { env } from "@/lib/env";
import {
  parseReconciliationSummary,
  type InvoiceStateDeltaSummary,
} from "@/lib/reliability/reconciliation-summary";
import { FormActionButton } from "@/components/form-action-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { hasAdvancedOperationsAccess } from "@/lib/auth/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

function formatSignedDelta(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

function ReconciliationDeltaSection<TState extends string>({
  emptyLabel,
  summary,
  title,
}: Readonly<{
  emptyLabel: string;
  summary: InvoiceStateDeltaSummary<TState>;
  title: string;
}>) {
  return (
    <div className="space-y-3 rounded-xl border border-border p-4">
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">
          Tracked rows:{" "}
          <span className="font-mono text-foreground">
            {summary.totalBefore} -&gt; {summary.totalAfter}
          </span>{" "}
          ({formatSignedDelta(summary.totalDelta)}).
        </p>
      </div>

      {summary.changed.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <div className="space-y-2">
          {summary.changed.map((entry) => (
            <div
              key={entry.state}
              className="flex items-center justify-between gap-3 rounded-lg border border-border/70 px-3 py-2"
            >
              <div className="space-y-1">
                <Badge variant="outline">{formatLabel(entry.state)}</Badge>
                <p className="text-xs text-muted-foreground">
                  Before/after count for this invoice state
                </p>
              </div>
              <div className="text-right">
                <p className="font-mono text-sm text-foreground">
                  {entry.before} -&gt; {entry.after}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatSignedDelta(entry.delta)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default async function SettingsPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  const resolvedSearchParams = await searchParams;
  const error = getSingleSearchParam(resolvedSearchParams.error) ?? null;
  const notice = getSingleSearchParam(resolvedSearchParams.notice) ?? null;
  const reconciliationSummary = parseReconciliationSummary(
    getSingleSearchParam(resolvedSearchParams.reconciliationSummary),
  );
  const tenantSelection = await getCurrentTenantSelectionForViewer();
  const session = tenantSelection.session;
  const canManageAdvancedOperations = hasAdvancedOperationsAccess(session);
  const tenantId = tenantSelection.currentTenant.id;

  const invoiceEmailOverrideTo = env.INVOICE_EMAIL_OVERRIDE_TO ?? null;
  const [billingSettings, selectedMode] = await Promise.all([
    ensureTenantBillingSettings(tenantId),
    getSelectedMollieMode(),
  ]);
  const billingDiscovery = await discoverEboekhoudenBillingSettings(tenantId).catch(
    (discoveryError) => ({
      error:
        discoveryError instanceof Error
          ? discoveryError.message
          : "Could not load e-Boekhouden billing data.",
    }),
  );
  const invoiceTemplates =
    billingDiscovery && "invoiceTemplates" in billingDiscovery
      ? billingDiscovery.invoiceTemplates
      : [];
  const ledgers =
    billingDiscovery && "ledgers" in billingDiscovery
      ? billingDiscovery.ledgers
      : [];
  const hasSavedTemplateOutsideDiscovery = Boolean(
    billingSettings?.invoiceTemplateId &&
      !invoiceTemplates.some(
        (template) => template.id === billingSettings.invoiceTemplateId,
      ),
  );
  const hasSavedLedgerOutsideDiscovery = Boolean(
    billingSettings?.revenueLedgerId &&
      !ledgers.some((ledger) => ledger.id === billingSettings.revenueLedgerId),
  );
  const billingSettingsComplete = billingSettingsAreComplete(billingSettings);

  if (!canManageAdvancedOperations) {
    return (
      <div className="mx-auto max-w-6xl space-y-6 p-8">
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Action failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {notice ? (
          <Alert>
            <AlertTitle>Updated</AlertTitle>
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        ) : null}

        <div>
          <h2 className="text-3xl font-bold tracking-tight">Settings</h2>
          <p className="mt-2 text-muted-foreground">
            Billing and accounting configuration for invoice automation.
          </p>
        </div>

        {invoiceEmailOverrideTo ? (
          <InlineNotice
            tone="warning"
            title="Invoice email override active"
            message={
              <>
                All invoice emails are currently being redirected to{" "}
                <span className="font-medium">{invoiceEmailOverrideTo}</span> instead
                of the actual client email address.
              </>
            }
          />
        ) : null}

        <RetentionPolicyCard />

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <CardTitle className="text-lg">Recurring invoice accounting</CardTitle>
              <form>
                <Button
                  type="submit"
                  variant="ghost"
                  size="icon-sm"
                  title="Refresh invoice templates and ledger accounts from e-Boekhouden."
                >
                  <RefreshCw className="size-4" />
                  <span className="sr-only">Refresh e-Boekhouden billing data</span>
                </Button>
              </form>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="rounded-xl border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
              e-Boekhouden will be the invoice and bookkeeping source. This app will
              not ask e-Boekhouden to email invoices; customer invoice delivery is
              handled by the app SMTP flow.
            </div>

            {billingDiscovery && "error" in billingDiscovery ? (
              <Alert variant="destructive">
                <AlertTitle>Discovery failed</AlertTitle>
                <AlertDescription>{billingDiscovery.error}</AlertDescription>
              </Alert>
            ) : null}

            <BillingSettingsForm
              defaultInvoiceTemplateId={billingSettings?.invoiceTemplateId}
              defaultRevenueLedgerId={billingSettings?.revenueLedgerId}
              hasSavedLedgerOutsideDiscovery={hasSavedLedgerOutsideDiscovery}
              hasSavedTemplateOutsideDiscovery={hasSavedTemplateOutsideDiscovery}
              invoiceTemplates={invoiceTemplates}
              ledgers={ledgers}
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  const [reliabilityOpsSnapshot, failedWebhookEvents, recentAuditActivity] = await Promise.all([
    getReliabilityOpsSnapshot({
      billingSettingsComplete,
      tenantId,
      mode: selectedMode,
    }),
    listFailedWebhookEvents({ limit: 8, mode: selectedMode, tenantId }),
    listRecentAuditActivity({ mode: selectedMode, tenantId }),
  ]);
  const {
    invoiceAutomation,
    invoiceAutomationCron,
    invoiceDeliveryQueue,
    reliability,
  } = reliabilityOpsSnapshot;
  const [
    dueInvoiceSummary,
    dueFirstPaymentInvoiceSummary,
    failedRecurringRetrySummary,
    failedFirstPaymentRetrySummary,
  ] =
    billingSettingsComplete
    ? await Promise.all([
        getDueRecurringInvoiceQueueSummary(selectedMode, tenantId),
        getDueFirstPaymentInvoiceQueueSummary(selectedMode, tenantId),
        getFailedRecurringInvoiceRetrySummary(selectedMode, tenantId),
        getFailedFirstPaymentInvoiceRetrySummary(selectedMode, tenantId),
      ])
    : [
        {
          actionableCount: 0,
          blockedCount: 0,
          dueCount: 0,
        },
        {
          actionableCount: 0,
          blockedCount: 0,
          dueCount: 0,
        },
        {
          retryableCount: 0,
          totalFailedCount: 0,
        },
        {
          retryableCount: 0,
          totalFailedCount: 0,
        },
      ];

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-8">
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Action failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {notice ? (
        <Alert>
          <AlertTitle>Updated</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}

      <div>
        <h2 className="text-3xl font-bold tracking-tight">Settings</h2>
        <p className="mt-2 text-muted-foreground">
          Billing and accounting configuration for invoice automation.
        </p>
      </div>

      {invoiceEmailOverrideTo ? (
        <InlineNotice
          tone="warning"
          title="Invoice email override active"
          message={
            <>
              All invoice emails are currently being redirected to{" "}
              <span className="font-medium">{invoiceEmailOverrideTo}</span> instead of the
              actual client email address.
            </>
          }
        />
      ) : null}

      <RetentionPolicyCard />

      <DeveloperSettingsToggle className="order-2">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <CardTitle className="text-lg">Operations overview</CardTitle>
              <p className="text-sm text-muted-foreground">
                Shared reliability snapshot for /settings and advanced /api/health diagnostics, plus webhook replay and recent repair activity.
              </p>
            </div>
            <Button asChild variant="outline">
              <Link href={`/api/health?tenantId=${tenantId}`} target="_blank">
                Open advanced diagnostics
              </Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border border-border p-4">
              <p className="text-sm font-medium">Webhook health</p>
              <p className="mt-2 text-2xl font-semibold">{reliability.failedWebhookCount}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                failed events in {selectedMode} mode; last received{" "}
                {reliability.lastReceivedWebhookAt
                  ? formatDateTime(reliability.lastReceivedWebhookAt)
                  : "never"}
              </p>
            </div>
            <div className="rounded-xl border border-border p-4">
              <p className="text-sm font-medium">Invoice automation</p>
              <p className="mt-2 text-2xl font-semibold">
                {billingSettingsComplete
                  ? invoiceAutomation.dueFirstPaymentPendingCount +
                    invoiceAutomation.dueRecurringPendingCount
                  : "n/a"}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {billingSettingsComplete ? (
                  <>
                    due creates; safe retries{" "}
                    {invoiceAutomation.failedFirstPaymentRecoverableCount}/
                    {invoiceAutomation.failedRecurringRecoverableCount}
                  </>
                ) : (
                  "Finish accounting settings before invoice automation counts are shown."
                )}
              </p>
            </div>
            <div className="rounded-xl border border-border p-4">
              <p className="text-sm font-medium">Delivery retries</p>
              <p className="mt-2 text-2xl font-semibold">
                {billingSettingsComplete
                  ? invoiceDeliveryQueue.dueRetryFirstPaymentCount +
                    invoiceDeliveryQueue.dueRetryRecurringCount
                  : "n/a"}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {billingSettingsComplete ? (
                  <>
                    first-payment + recurring retries; permanent failures{" "}
                    {invoiceDeliveryQueue.permanentFailureFirstPaymentCount}/
                    {invoiceDeliveryQueue.permanentFailureRecurringCount}
                  </>
                ) : (
                  "Finish accounting settings before delivery retry counts are shown."
                )}
              </p>
            </div>
            <div className="rounded-xl border border-border p-4">
              <p className="text-sm font-medium">Cron heartbeat</p>
              <p className="mt-2 text-sm font-semibold">
                {invoiceAutomationCron.lastCronRunOutcome ?? "n/a"}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                last run {invoiceAutomationCron.lastCronRunAt ?? "never"}
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
            This snapshot is the same one returned by advanced <code>/api/health</code> diagnostics, so operators can read one set of reliability numbers in both places.
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.4fr,1fr]">
            <div className="rounded-xl border border-border p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Failed webhook replay queue</p>
                  <p className="text-sm text-muted-foreground">
                    Replay only failed stored webhook events for current mode. Successful or pending rows stay out of this control.
                  </p>
                </div>
                <Badge variant="outline">{failedWebhookEvents.length}</Badge>
              </div>

              {failedWebhookEvents.length === 0 ? (
                <p className="mt-4 text-sm text-muted-foreground">
                  No failed webhook events with replayable resources.
                </p>
              ) : (
                <div className="mt-4">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Received</TableHead>
                        <TableHead>Resource</TableHead>
                        <TableHead>Attempts</TableHead>
                        <TableHead>Error</TableHead>
                        <TableHead className="text-right">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {failedWebhookEvents.map((event) => (
                        <TableRow key={event.id}>
                          <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                            {formatDateTime(event.receivedAt)}
                          </TableCell>
                          <TableCell className="text-sm">
                            <div className="font-medium">{event.resourceId}</div>
                            <div className="text-muted-foreground">{event.resourceType ?? "unknown"}</div>
                          </TableCell>
                          <TableCell className="text-sm">{event.retryCount}</TableCell>
                          <TableCell className="max-w-[18rem] text-sm text-muted-foreground">
                            {event.errorMessage ?? "Unknown failure"}
                          </TableCell>
                          <TableCell className="text-right">
                            <form action={replayWebhookEventAction}>
                              <input type="hidden" name="returnTo" value="/settings" />
                              <input type="hidden" name="webhookEventId" value={event.id} />
                              <FormActionButton
                                confirmMessage={`Replay failed ${event.resourceType ?? "webhook"} ${event.resourceId ?? event.id}? This only reprocesses failed stored events in the current mode.`}
                                pendingLabel="Replaying..."
                                variant="secondary"
                              >
                                Replay failed event
                              </FormActionButton>
                            </form>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>

            <div className="rounded-xl border border-border p-4">
              <p className="text-sm font-medium">Recent reliability activity</p>
              <p className="text-sm text-muted-foreground">
                Latest audit rows for repair, replay, reconciliation, and operator-triggered billing operations.
              </p>

              {recentAuditActivity.length === 0 ? (
                <p className="mt-4 text-sm text-muted-foreground">No recent audit activity.</p>
              ) : (
                <div className="mt-4 space-y-3">
                  {recentAuditActivity.map((item) => (
                    <div key={item.id} className="rounded-lg border border-border p-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-medium">{item.summary}</p>
                        <Badge variant={item.outcome === "success" ? "secondary" : "destructive"}>
                          {item.outcome}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {item.action} • {formatDateTime(item.createdAt)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-border p-4">
            <div className="space-y-2">
              <p className="text-sm font-medium">Automation health snapshot</p>
              <p className="text-sm text-muted-foreground">
                Current mode: {selectedMode}. Pending first-payment creates: {invoiceAutomation.dueFirstPaymentPendingCount}. Pending recurring creates due now: {invoiceAutomation.dueRecurringPendingCount}.
              </p>
              <p className="text-sm text-muted-foreground">
                Failed first-payment rows: {invoiceAutomation.failedFirstPaymentCount} (recoverable: {invoiceAutomation.failedFirstPaymentRecoverableCount}). Failed recurring rows: {invoiceAutomation.failedRecurringCount} (recoverable: {invoiceAutomation.failedRecurringRecoverableCount}).
              </p>
              <p className="text-sm text-muted-foreground">
                Webhooks received / processed: {reliability.lastReceivedWebhookAt ? formatDateTime(reliability.lastReceivedWebhookAt) : "never"} / {reliability.lastProcessedWebhookAt ? formatDateTime(reliability.lastProcessedWebhookAt) : "never"}.
              </p>
              <p className="text-sm text-muted-foreground">
                Failed webhook events: {reliability.failedWebhookCount}. Open alerts: {reliability.openAlertCount}. Unresolved alerts: {reliability.unresolvedAlertCount}.
              </p>
              <p className="text-sm text-muted-foreground">
                Email retries due now (first-payment/recurring): {invoiceDeliveryQueue.dueRetryFirstPaymentCount}/{invoiceDeliveryQueue.dueRetryRecurringCount}. Permanent delivery failures (first-payment/recurring): {invoiceDeliveryQueue.permanentFailureFirstPaymentCount}/{invoiceDeliveryQueue.permanentFailureRecurringCount}.
              </p>
              <p className="text-sm text-muted-foreground">
                Last automation cron run: {invoiceAutomationCron.lastCronRunAt ?? "never"} ({invoiceAutomationCron.lastCronRunOutcome ?? "n/a"}). Last success: {invoiceAutomationCron.lastCronSuccessAt ?? "never"}. Last failure: {invoiceAutomationCron.lastCronFailureAt ?? "never"}.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Mollie reconciliation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Run an explicit reconciliation pass for the current mode when local payment,
            payment-link, or subscription state looks stale. Default mode is sync-only so operators
            can inspect refreshed Mollie state before allowing billing follow-ups.
          </p>
          <p className="text-sm text-muted-foreground">
            Current mode: <span className="font-medium text-foreground">{selectedMode}</span>.
          </p>
          <form action={runReconciliationAction} className="space-y-4">
            <input type="hidden" name="returnTo" value="/settings" />
            <div className="space-y-2">
              <label
                htmlFor="reconciliationMode"
                className="text-sm font-medium text-foreground"
              >
                Reconciliation mode
              </label>
              <select
                id="reconciliationMode"
                name="reconciliationMode"
                defaultValue="sync_only"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="sync_only">
                  Sync-only: refresh Mollie state only, no invoice create or activation follow-ups
                </option>
                <option value="full">
                  Full: refresh Mollie state and allow invoice create / activation follow-ups
                </option>
              </select>
            </div>
            <div className="rounded-xl border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
              Sync-only keeps first-payment invoice creation and subscription activation off. Full
              mode keeps current automatic follow-up behavior after paid first-payment sync.
            </div>
            <FormActionButton
              confirmMessage={`Run ${selectedMode} reconciliation now? Verify selected mode first.`}
              pendingLabel="Reconciling..."
            >
              Run reconciliation
            </FormActionButton>
          </form>

          {reconciliationSummary ? (
            <div className="rounded-xl border border-border bg-muted/20 p-4">
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="space-y-1">
                    <p className="text-sm font-medium">Latest reconciliation result</p>
                    <p className="text-sm text-muted-foreground">
                      Ran {formatDateTime(reconciliationSummary.ranAt)} in{" "}
                      {reconciliationSummary.mode ?? "all"} mode with{" "}
                      {reconciliationSummary.reconciliationMode === "sync_only"
                        ? "sync-only"
                        : "full"}{" "}
                      follow-up behavior.
                    </p>
                  </div>
                  <Badge variant="outline">
                    {reconciliationSummary.reconciliationMode === "sync_only"
                      ? "Sync-only"
                      : "Full"}
                  </Badge>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-lg border border-border bg-background p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      Subscriptions checked
                    </p>
                    <p className="mt-2 font-mono text-lg text-foreground">
                      {reconciliationSummary.subscriptionsChecked}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border bg-background p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      Payment links checked
                    </p>
                    <p className="mt-2 font-mono text-lg text-foreground">
                      {reconciliationSummary.paymentLinksChecked}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border bg-background p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      First payments checked
                    </p>
                    <p className="mt-2 font-mono text-lg text-foreground">
                      {reconciliationSummary.firstPaymentsChecked}
                    </p>
                  </div>
                </div>

                <div className="grid gap-4 xl:grid-cols-2">
                  <ReconciliationDeltaSection
                    emptyLabel="No first-payment invoice state changes detected."
                    summary={reconciliationSummary.firstPaymentInvoiceStateDelta}
                    title="First-payment invoice state delta"
                  />
                  <ReconciliationDeltaSection
                    emptyLabel="No recurring invoice state changes detected."
                    summary={reconciliationSummary.recurringInvoiceStateDelta}
                    title="Recurring invoice state delta"
                  />
                </div>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Targeted repair</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Repair one stale customer, payment, or subscription in the current mode when a
            focused resync is safer than a broader reconciliation pass.
          </p>
          <form action={repairReliabilityTargetAction} className="space-y-4">
            <input type="hidden" name="returnTo" value="/settings" />
            <div className="grid gap-4 md:grid-cols-[180px,1fr]">
              <div className="space-y-2">
                <label
                  htmlFor="repairTargetKind"
                  className="text-sm font-medium text-foreground"
                >
                  Target type
                </label>
                <select
                  id="repairTargetKind"
                  name="repairTargetKind"
                  defaultValue="customer"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="customer">Customer</option>
                  <option value="payment">Payment</option>
                  <option value="subscription">Subscription</option>
                </select>
              </div>
              <div className="space-y-2">
                <label
                  htmlFor="repairTargetId"
                  className="text-sm font-medium text-foreground"
                >
                  Target id
                </label>
                <input
                  id="repairTargetId"
                  name="repairTargetId"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  placeholder="uuid"
                />
              </div>
            </div>
            <div className="rounded-xl border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
              Batch repair still runs through protected cron recovery. This form is for a single
              target only.
            </div>
            <FormActionButton
              confirmMessage="Repair the selected target now? This re-syncs the record in the current mode."
              pendingLabel="Repairing..."
            >
              Repair target
            </FormActionButton>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Email</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Send a test notification email to verify SMTP delivery and preview the alert template.
          </p>
          <form action={sendTestAlertAction}>
            <input type="hidden" name="returnTo" value="/settings" />
            <Button type="submit">Send test email</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Invoice automation controls</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="rounded-xl border border-border p-4">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium">Create due first-payment invoices</p>
                <p className="text-sm text-muted-foreground">
                  Current mode: {selectedMode}. Ready now: {dueFirstPaymentInvoiceSummary.actionableCount}. Blocked by missing e-Boekhouden customer link: {dueFirstPaymentInvoiceSummary.blockedCount}.
                </p>
                {!billingSettingsComplete ? (
                  <p className="text-sm text-muted-foreground">
                    Finish the invoice template and revenue ledger settings before creating invoices.
                  </p>
                ) : null}
              </div>

              <form action={createDueFirstPaymentInvoicesAction}>
                <input type="hidden" name="returnTo" value="/settings" />
                <Button
                  type="submit"
                  disabled={
                    !billingSettingsComplete ||
                    dueFirstPaymentInvoiceSummary.actionableCount === 0
                  }
                >
                  Create due first-payment invoices
                </Button>
              </form>
            </div>
          </div>

          <div className="rounded-xl border border-border p-4">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium">Create due recurring invoices</p>
                <p className="text-sm text-muted-foreground">
                  Current mode: {selectedMode}. Ready now: {dueInvoiceSummary.actionableCount}. Blocked by missing e-Boekhouden customer link: {dueInvoiceSummary.blockedCount}.
                </p>
                {!billingSettingsComplete ? (
                  <p className="text-sm text-muted-foreground">
                    Finish the invoice template and revenue ledger settings before creating invoices.
                  </p>
                ) : null}
              </div>

              <form action={createDueRecurringInvoicesAction}>
                <input type="hidden" name="returnTo" value="/settings" />
                <Button
                  type="submit"
                  disabled={!billingSettingsComplete || dueInvoiceSummary.actionableCount === 0}
                >
                  Create due invoices
                </Button>
              </form>
            </div>
          </div>

          <div className="rounded-xl border border-border p-4">
            <div className="space-y-3">
              <p className="text-sm font-medium">Queue controlled retry for failed first-payment invoices</p>
              <p className="text-sm text-muted-foreground">
                Current mode: {selectedMode}. Failed rows: {failedFirstPaymentRetrySummary.totalFailedCount}. Retry-safe rows: {failedFirstPaymentRetrySummary.retryableCount} (safe retry codes: FACT_014, FACT_VERWERK_004).
              </p>
              <form action={queueFailedFirstPaymentInvoiceRetriesAction} className="space-y-3">
                <input type="hidden" name="returnTo" value="/settings" />
                <label htmlFor="paymentIds" className="text-sm text-muted-foreground">
                  Failed payment IDs (comma or newline separated)
                </label>
                <textarea
                  id="paymentIds"
                  name="paymentIds"
                  className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  placeholder="d66c7b77-6d6f-4e95-bc09-70b5638fded1"
                />
                <Button
                  type="submit"
                  disabled={!billingSettingsComplete || failedFirstPaymentRetrySummary.retryableCount === 0}
                >
                  Queue safe failed first-payment retries
                </Button>
              </form>
            </div>
          </div>

          <div className="rounded-xl border border-border p-4">
            <div className="space-y-3">
              <p className="text-sm font-medium">Queue controlled retry for failed recurring invoices</p>
              <p className="text-sm text-muted-foreground">
                Current mode: {selectedMode}. Failed rows: {failedRecurringRetrySummary.totalFailedCount}. Retry-safe rows: {failedRecurringRetrySummary.retryableCount} (safe retry codes: FACT_014, FACT_VERWERK_004).
              </p>
              <form action={queueFailedRecurringInvoiceRetriesAction} className="space-y-3">
                <input type="hidden" name="returnTo" value="/settings" />
                <label htmlFor="scheduleIds" className="text-sm text-muted-foreground">
                  Failed schedule IDs (comma or newline separated)
                </label>
                <textarea
                  id="scheduleIds"
                  name="scheduleIds"
                  className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  placeholder="a136d64f-23a4-4633-ac74-60234b555618"
                />
                <Button
                  type="submit"
                  disabled={!billingSettingsComplete || failedRecurringRetrySummary.retryableCount === 0}
                >
                  Queue safe failed retries
                </Button>
              </form>
            </div>
          </div>
        </CardContent>
      </Card>
      </DeveloperSettingsToggle>
    </div>
  );
}
