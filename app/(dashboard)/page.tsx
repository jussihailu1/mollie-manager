import Link from "next/link";

import { AppIcon } from "@/components/app-icon";
import { DetailSection } from "@/components/detail-section";
import { EmptyState } from "@/components/empty-state";
import { EntityListRow } from "@/components/entity-list-row";
import { KpiStrip } from "@/components/kpi-strip";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import {
  getSelectedMollieMode,
  resolveDashboardModeFilter,
  type DashboardModeFilter,
} from "@/lib/dashboard-mode";
import { getSingleSearchParam } from "@/lib/format";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { listCustomers, listPayments, listSubscriptions } from "@/lib/onboarding/data";
import {
  getReliabilitySnapshot,
  listAlertInbox,
  listRecentWebhookEvents,
} from "@/lib/reliability/data";

function getAlertHref(alert: Awaited<ReturnType<typeof listAlertInbox>>[number]) {
  if (alert.subscriptionId) {
    return `/subscriptions?focus=${alert.subscriptionId}`;
  }

  if (alert.paymentId) {
    return `/payments?focus=${alert.paymentId}`;
  }

  if (alert.customerId) {
    return `/customers/${alert.customerId}`;
  }

  return "/alerts";
}

function getModePillTone(mode: DashboardModeFilter) {
  if (mode === "all") {
    return "muted";
  }

  return mode === "live" ? "warning" : "accent";
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function OverviewPage({
  searchParams,
}: Readonly<{
  searchParams: SearchParams;
}>) {
  const resolvedSearchParams = await searchParams;
  const selectedMode = await getSelectedMollieMode();
  const effectiveMode = await resolveDashboardModeFilter(
    getSingleSearchParam(resolvedSearchParams.mode),
  );
  const [alerts, customers, payments, reliability, subscriptions, webhookEvents] =
    await Promise.all([
      listAlertInbox({ mode: effectiveMode }),
      listCustomers({ mode: effectiveMode }),
      listPayments({ mode: effectiveMode }),
      getReliabilitySnapshot({ mode: effectiveMode }),
      listSubscriptions({ mode: effectiveMode }),
      listRecentWebhookEvents({ mode: effectiveMode }),
    ]);

  const activeSubscriptions = subscriptions.filter(
    (subscription) => subscription.localStatus === "active",
  ).length;
  const setupCustomers = customers.filter(
    (customer) =>
      customer.latestSubscriptionStatus !== "active" &&
      customer.latestFirstPaymentStatus !== "paid",
  ).length;
  const readyCustomers = customers.filter(
    (customer) =>
      customer.latestSubscriptionStatus !== "active" &&
      customer.latestFirstPaymentStatus === "paid" &&
      customer.hasValidMandate,
  ).length;
  const failedPayments = payments.filter((payment) =>
    ["failed", "expired"].includes(payment.mollieStatus ?? ""),
  ).length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operations home"
        title="Run subscriptions without losing the queue"
        description="The home screen stays focused on what needs action now: alerts, customers still moving through setup, and the freshest signals from Mollie."
        actions={
          <>
            <StatusPill tone={getModePillTone(effectiveMode)}>
              {effectiveMode === "all"
                ? "Viewing all modes"
                : `Viewing ${effectiveMode} mode`}
            </StatusPill>
            {effectiveMode !== selectedMode ? (
              <StatusPill tone={getModePillTone(selectedMode)}>
                Default {selectedMode}
              </StatusPill>
            ) : null}
            <Link
              href="/alerts"
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-border-strong bg-surface px-3.5 py-2 text-sm font-medium text-ink-soft transition-colors hover:bg-surface-muted hover:text-ink"
            >
              <AppIcon name="alert" />
              Open alerts
            </Link>
            <Link
              href="/customers"
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-ink px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-ink/88"
            >
              <AppIcon name="customer" />
              Open customers
            </Link>
          </>
        }
      />

      <KpiStrip
        items={[
          {
            label: "Open alerts",
            value: reliability.openAlertCount,
            helper: reliability.openAlertCount > 0 ? "needs review" : "clear",
            tone: reliability.openAlertCount > 0 ? "warning" : "accent",
          },
          {
            label: "Customers in setup",
            value: setupCustomers,
            helper: readyCustomers > 0 ? `${readyCustomers} ready` : "in flight",
            tone: readyCustomers > 0 ? "accent" : "neutral",
          },
          {
            label: "Active subscriptions",
            value: activeSubscriptions,
            helper: failedPayments > 0 ? `${failedPayments} failures` : "stable",
            tone: failedPayments > 0 ? "warning" : "accent",
          },
          {
            label: "Webhook failures",
            value: reliability.failedWebhookCount,
            helper:
              reliability.failedWebhookCount > 0
                ? "replay needed"
                : "all processed",
            tone:
              reliability.failedWebhookCount > 0 ? "warning" : "neutral",
          },
        ]}
      />

      <section className="grid gap-6 xl:grid-cols-[1.12fr_0.88fr]">
        <DetailSection
          title="Needs attention"
          description="Open alerts stay at the top. If the queue is clear, you should only see fresh operational signals in the module pages."
          actions={
            <Link
              href="/alerts"
              className="inline-flex items-center gap-1 text-sm font-medium text-accent-strong transition-colors hover:text-accent"
            >
              See full queue
              <AppIcon name="chevron-right" className="h-4 w-4" />
            </Link>
          }
        >
          {alerts.length === 0 ? (
            <EmptyState
              title="No unresolved alerts"
              description="Failures, chargebacks, and out-of-sync states will appear here when they need review."
            />
          ) : (
            <div className="space-y-3">
              {alerts.slice(0, 5).map((alert) => (
                <EntityListRow
                  key={alert.id}
                  title={alert.title}
                  description={alert.message}
                  badges={
                    <>
                      <StatusPill
                        tone={alert.severity === "critical" ? "critical" : "warning"}
                      >
                        {alert.severity}
                      </StatusPill>
                      <StatusPill tone={alert.status === "open" ? "warning" : "muted"}>
                        {alert.status}
                      </StatusPill>
                    </>
                  }
                  meta={`${alert.customerName ?? "Unknown customer"}${
                    alert.customerEmail ? ` - ${alert.customerEmail}` : ""
                  } - ${formatDateTime(alert.createdAt)}`}
                  actions={
                    <Link
                      href={getAlertHref(alert)}
                      className="inline-flex min-h-9 items-center justify-center rounded-lg border border-border-strong px-3 py-1.5 text-sm font-medium text-ink-soft transition-colors hover:bg-surface-muted hover:text-ink"
                    >
                      Open
                    </Link>
                  }
                />
              ))}
            </div>
          )}
        </DetailSection>

        <DetailSection title="Quick actions" description="Jump straight into the workflows that matter most.">
          <div className="grid gap-3 sm:grid-cols-2">
            <Link
              href="/customers"
              className="rounded-[16px] border border-border bg-surface-subtle px-4 py-4 transition-colors hover:bg-surface-muted"
            >
              <div className="flex items-center gap-3">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft text-accent-strong">
                  <AppIcon name="customer" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-ink">Create customer</p>
                  <p className="mt-1 text-sm text-ink-soft">Start a new subscription setup flow.</p>
                </div>
              </div>
            </Link>
            <Link
              href="/subscriptions"
              className="rounded-[16px] border border-border bg-surface-subtle px-4 py-4 transition-colors hover:bg-surface-muted"
            >
              <div className="flex items-center gap-3">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-surface text-ink">
                  <AppIcon name="subscription" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-ink">Review subscriptions</p>
                  <p className="mt-1 text-sm text-ink-soft">Check next charges and guarded actions.</p>
                </div>
              </div>
            </Link>
            <Link
              href="/payments"
              className="rounded-[16px] border border-border bg-surface-subtle px-4 py-4 transition-colors hover:bg-surface-muted"
            >
              <div className="flex items-center gap-3">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-surface text-ink">
                  <AppIcon name="payment" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-ink">Inspect payments</p>
                  <p className="mt-1 text-sm text-ink-soft">Trace first payments and recurring charges.</p>
                </div>
              </div>
            </Link>
            <Link
              href="/settings"
              className="rounded-[16px] border border-border bg-surface-subtle px-4 py-4 transition-colors hover:bg-surface-muted"
            >
              <div className="flex items-center gap-3">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-surface text-ink">
                  <AppIcon name="settings" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-ink">Run reliability tools</p>
                  <p className="mt-1 text-sm text-ink-soft">Replay webhooks, reconcile, and test alerts.</p>
                </div>
              </div>
            </Link>
          </div>
        </DetailSection>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <DetailSection
          title="Subscription pipeline"
          description="Customers only move forward when the first payment is paid and the mandate is ready."
        >
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-[16px] border border-border bg-surface-subtle px-4 py-4">
              <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-ink-soft">
                Awaiting first payment
              </p>
              <p className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-ink">
                {setupCustomers}
              </p>
            </div>
            <div className="rounded-[16px] border border-border bg-surface-subtle px-4 py-4">
              <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-ink-soft">
                Ready to subscribe
              </p>
              <p className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-ink">
                {readyCustomers}
              </p>
            </div>
            <div className="rounded-[16px] border border-border bg-surface-subtle px-4 py-4">
              <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-ink-soft">
                Active
              </p>
              <p className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-ink">
                {activeSubscriptions}
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {customers.slice(0, 4).map((customer) => (
              <EntityListRow
                key={customer.id}
                title={customer.fullName ?? "Unnamed customer"}
                description={customer.email}
                badges={
                  <StatusPill
                    tone={
                      customer.latestSubscriptionStatus === "active"
                        ? "accent"
                        : customer.hasValidMandate &&
                            customer.latestFirstPaymentStatus === "paid"
                          ? "warning"
                          : "muted"
                    }
                  >
                    {customer.latestSubscriptionStatus === "active"
                      ? "active"
                      : customer.hasValidMandate &&
                          customer.latestFirstPaymentStatus === "paid"
                        ? "ready"
                        : "setup"}
                  </StatusPill>
                }
                meta={`First payment ${customer.latestFirstPaymentStatus ?? "missing"} - mandate ${customer.latestMandateStatus ?? "missing"}`}
                actions={
                  <Link
                    href={`/customers/${customer.id}`}
                    className="inline-flex min-h-9 items-center justify-center rounded-lg border border-border-strong px-3 py-1.5 text-sm font-medium text-ink-soft transition-colors hover:bg-surface-muted hover:text-ink"
                  >
                    Open
                  </Link>
                }
              />
            ))}
          </div>
        </DetailSection>

        <DetailSection
          title="Recent activity"
          description="Webhook receipts and payment movement are the fastest way to confirm the system is still flowing."
        >
          {webhookEvents.length === 0 && payments.length === 0 ? (
            <EmptyState
              title="No activity yet"
              description="Webhook deliveries and locally stored payments will appear here once the first customer flow runs."
            />
          ) : (
            <div className="space-y-3">
              {webhookEvents.slice(0, 3).map((event) => (
                <EntityListRow
                  key={event.id}
                  title={event.resourceId ?? "Webhook event"}
                  description={`Webhook ${event.processingStatus}`}
                  badges={
                    <StatusPill
                      tone={
                        event.processingStatus === "failed" ? "warning" : "muted"
                      }
                    >
                      {event.processingStatus}
                    </StatusPill>
                  }
                  meta={`Received ${formatDateTime(event.receivedAt)} - retries ${event.retryCount}`}
                />
              ))}
              {payments.slice(0, 2).map((payment) => (
                <EntityListRow
                  key={payment.id}
                  title={formatCurrency(payment.amountValue, payment.amountCurrency)}
                  description={`${payment.customerName ?? "Unknown customer"}${
                    payment.customerEmail ? ` - ${payment.customerEmail}` : ""
                  }`}
                  badges={
                    <StatusPill
                      tone={
                        payment.mollieStatus === "paid"
                          ? "accent"
                          : payment.mollieStatus === "failed" ||
                              payment.mollieStatus === "expired"
                            ? "warning"
                            : "muted"
                      }
                    >
                      {payment.mollieStatus ?? "unknown"}
                    </StatusPill>
                  }
                  meta={`Stored ${formatDateTime(payment.createdAt)}${
                    payment.paidAt ? ` - paid ${formatDateTime(payment.paidAt)}` : ""
                  }`}
                  actions={
                    payment.customerId ? (
                      <Link
                        href={`/customers/${payment.customerId}`}
                        className="inline-flex min-h-9 items-center justify-center rounded-lg border border-border-strong px-3 py-1.5 text-sm font-medium text-ink-soft transition-colors hover:bg-surface-muted hover:text-ink"
                      >
                        Open
                      </Link>
                    ) : null
                  }
                />
              ))}
            </div>
          )}
        </DetailSection>
      </section>
    </div>
  );
}
