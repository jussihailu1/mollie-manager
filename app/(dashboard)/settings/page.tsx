import { RefreshCw } from "lucide-react";

import { BillingSettingsForm } from "@/app/(dashboard)/settings/billing-settings-form";
import { InlineNotice } from "@/components/inline-notice";
import {
  createDueFirstPaymentInvoicesAction,
  createDueRecurringInvoicesAction,
  queueFailedFirstPaymentInvoiceRetriesAction,
  queueFailedRecurringInvoiceRetriesAction,
} from "@/lib/billing-actions";
import {
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
import { getSingleSearchParam } from "@/lib/format";
import {
  getInvoiceAutomationCronHeartbeat,
  getInvoiceAutomationSnapshot,
} from "@/lib/invoice-automation-metrics";
import { getInvoiceDeliveryQueueSummary } from "@/lib/invoice-delivery";
import { getReliabilitySnapshot } from "@/lib/reliability/data";
import { env } from "@/lib/env";
import { FormActionButton } from "@/components/form-action-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";
export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  const resolvedSearchParams = await searchParams;
  const error = getSingleSearchParam(resolvedSearchParams.error) ?? null;
  const notice = getSingleSearchParam(resolvedSearchParams.notice) ?? null;
  const invoiceEmailOverrideTo = env.INVOICE_EMAIL_OVERRIDE_TO ?? null;
  const [billingSettings, selectedMode] = await Promise.all([
    ensureTenantBillingSettings(),
    getSelectedMollieMode(),
  ]);
  const billingDiscovery = await discoverEboekhoudenBillingSettings().catch(
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
  const invoiceAutomationCronHeartbeat = await getInvoiceAutomationCronHeartbeat(
    selectedMode,
  );
  const reliabilitySnapshot = await getReliabilitySnapshot({ mode: selectedMode });
  const [
    dueInvoiceSummary,
    dueFirstPaymentInvoiceSummary,
    failedRecurringRetrySummary,
    failedFirstPaymentRetrySummary,
    invoiceAutomationSnapshot,
    invoiceDeliveryQueueSummary,
  ] =
    billingSettingsComplete
    ? await Promise.all([
        getDueRecurringInvoiceQueueSummary(selectedMode),
        getDueFirstPaymentInvoiceQueueSummary(selectedMode),
        getFailedRecurringInvoiceRetrySummary(selectedMode),
        getFailedFirstPaymentInvoiceRetrySummary(selectedMode),
        getInvoiceAutomationSnapshot(selectedMode),
        getInvoiceDeliveryQueueSummary(selectedMode),
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
        {
          dueFirstPaymentPendingCount: 0,
          dueRecurringPendingCount: 0,
          failedFirstPaymentCount: 0,
          failedFirstPaymentRecoverableCount: 0,
          failedRecurringCount: 0,
          failedRecurringRecoverableCount: 0,
        },
        {
          dueRetryFirstPaymentCount: 0,
          dueRetryRecurringCount: 0,
          permanentFailureFirstPaymentCount: 0,
          permanentFailureRecurringCount: 0,
        },
      ];

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-8">
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
          SMTP diagnostics, e-Boekhouden billing settings, and basic system actions.
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

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Mollie repair pass</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Run the explicit full Mollie repair pass for the current mode when local payment,
            payment-link, or subscription state looks stale. This is not part of the passive
            refresh flow.
          </p>
          <p className="text-sm text-muted-foreground">
            Current mode: <span className="font-medium text-foreground">{selectedMode}</span>.
          </p>
          <form action={runReconciliationAction}>
            <input type="hidden" name="returnTo" value="/settings" />
            <FormActionButton
              confirmMessage={`Run the full ${selectedMode} Mollie repair pass now?`}
              pendingLabel="Repairing..."
            >
              Run repair pass
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

          <div className="rounded-xl border border-border p-4">
            <div className="space-y-2">
              <p className="text-sm font-medium">Automation health snapshot</p>
              <p className="text-sm text-muted-foreground">
                Current mode: {selectedMode}. Pending first-payment creates: {invoiceAutomationSnapshot.dueFirstPaymentPendingCount}. Pending recurring creates due now: {invoiceAutomationSnapshot.dueRecurringPendingCount}.
              </p>
              <p className="text-sm text-muted-foreground">
                Failed first-payment rows: {invoiceAutomationSnapshot.failedFirstPaymentCount} (recoverable: {invoiceAutomationSnapshot.failedFirstPaymentRecoverableCount}). Failed recurring rows: {invoiceAutomationSnapshot.failedRecurringCount} (recoverable: {invoiceAutomationSnapshot.failedRecurringRecoverableCount}).
              </p>
              <p className="text-sm text-muted-foreground">
                Webhooks received / processed: {reliabilitySnapshot.lastReceivedWebhookAt ? formatDateTime(reliabilitySnapshot.lastReceivedWebhookAt) : "never"} / {reliabilitySnapshot.lastProcessedWebhookAt ? formatDateTime(reliabilitySnapshot.lastProcessedWebhookAt) : "never"}.
              </p>
              <p className="text-sm text-muted-foreground">
                Failed webhook events: {reliabilitySnapshot.failedWebhookCount}. Open alerts: {reliabilitySnapshot.openAlertCount}. Unresolved alerts: {reliabilitySnapshot.unresolvedAlertCount}.
              </p>
              <p className="text-sm text-muted-foreground">
                Email retries due now (first-payment/recurring): {invoiceDeliveryQueueSummary.dueRetryFirstPaymentCount}/{invoiceDeliveryQueueSummary.dueRetryRecurringCount}. Permanent delivery failures (first-payment/recurring): {invoiceDeliveryQueueSummary.permanentFailureFirstPaymentCount}/{invoiceDeliveryQueueSummary.permanentFailureRecurringCount}.
              </p>
              <p className="text-sm text-muted-foreground">
                Last automation cron run: {invoiceAutomationCronHeartbeat.lastCronRunAt ?? "never"} ({invoiceAutomationCronHeartbeat.lastCronRunOutcome ?? "n/a"}). Last success: {invoiceAutomationCronHeartbeat.lastCronSuccessAt ?? "never"}. Last failure: {invoiceAutomationCronHeartbeat.lastCronFailureAt ?? "never"}.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
