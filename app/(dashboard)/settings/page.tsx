import { RefreshCw } from "lucide-react";

import { BillingSettingsForm } from "@/app/(dashboard)/settings/billing-settings-form";
import { createDueRecurringInvoicesAction } from "@/lib/billing-actions";
import { sendTestAlertAction } from "@/lib/reliability/actions";
import {
  billingSettingsAreComplete,
  discoverEboekhoudenBillingSettings,
  ensureTenantBillingSettings,
} from "@/lib/billing-settings";
import { getSelectedMollieMode } from "@/lib/dashboard-mode";
import { getDueRecurringInvoiceQueueSummary } from "@/lib/eboekhouden/recurring-invoices";
import { getSingleSearchParam } from "@/lib/format";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  const resolvedSearchParams = await searchParams;
  const error = getSingleSearchParam(resolvedSearchParams.error) ?? null;
  const notice = getSingleSearchParam(resolvedSearchParams.notice) ?? null;
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
  const dueInvoiceSummary = billingSettingsComplete
    ? await getDueRecurringInvoiceQueueSummary(selectedMode)
    : {
        actionableCount: 0,
        blockedCount: 0,
        dueCount: 0,
      };

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
            not ask e-Boekhouden to email invoices; customer email delivery stays
            with the app SMTP flow for a later phase.
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
        </CardContent>
      </Card>
    </div>
  );
}
