import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  CreditCard,
  FileText,
  Users,
} from "lucide-react";

import { DashboardActions } from "@/components/dashboard-actions";
import { DashboardRevenue } from "@/components/dashboard-revenue";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { deriveCustomerLifecycleState } from "@/lib/customer-lifecycle-state";
import { getSelectedMollieMode } from "@/lib/dashboard-mode";
import {
  buildDashboardRevenue,
  dashboardCalendarDate,
  isCurrentRecurringSubscription,
} from "@/lib/dashboard-metrics";
import { hasTenantEboekhoudenCredentials } from "@/lib/eboekhouden/tenant-credentials";
import { formatDateTime } from "@/lib/format";
import { getNeedsAttentionImpact } from "@/lib/needs-attention-presentation";
import {
  listCustomers,
  listPayments,
  listSubscriptions,
} from "@/lib/onboarding/data";
import { getCurrentTenantSelectionForViewer } from "@/lib/tenant-context";
import { listRecentAuditActivity } from "@/lib/reliability/data";
import { listNeedsAttentionItems } from "@/lib/reliability/needs-attention";
import { toUiAttentionRecord, toUiCustomerRecord } from "@/lib/ui-data";

export default async function OverviewPage() {
  const { currentTenant } = await getCurrentTenantSelectionForViewer();
  const selectedMode = await getSelectedMollieMode();
  const tenantId = currentTenant.id;
  const [
    customersResult,
    payments,
    subscriptions,
    activity,
    attentionResult,
    hasEboekhoudenConnection,
  ] = await Promise.all([
    listCustomers({ mode: selectedMode, tenantId }),
    listPayments({ mode: selectedMode, tenantId }),
    listSubscriptions({ mode: selectedMode, tenantId }),
    listRecentAuditActivity({ mode: selectedMode, tenantId }),
    listNeedsAttentionItems({ limit: 4, mode: selectedMode, tenantId }),
    hasTenantEboekhoudenCredentials(tenantId),
  ]);
  const now = new Date();
  const customers = customersResult.map(toUiCustomerRecord);
  const attentionItems = attentionResult.map(toUiAttentionRecord);
  const revenues = buildDashboardRevenue(subscriptions, payments, now);
  const activeSubscriptions = subscriptions.filter((subscription) =>
    isCurrentRecurringSubscription(subscription, now),
  ).length;
  const awaitingActivation = customers.filter((customer) => {
    const lifecycle = deriveCustomerLifecycleState(customer, { now });
    return (
      lifecycle.state === "onboarding" ||
      (lifecycle.state === "needs_setup" && customer.subscriptionCount === 0) ||
      lifecycle.reason === "subscription_setup_pending"
    );
  }).length;
  const thisMonth = dashboardCalendarDate(now).slice(0, 7);
  const newCustomers = customers.filter(
    (customer) =>
      dashboardCalendarDate(new Date(customer.createdAt)).slice(0, 7) ===
      thisMonth,
  ).length;
  const dateLabel = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Europe/Amsterdam",
  }).format(now);

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <p className="text-xs text-muted-foreground">{dateLabel}</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your recurring business, at a glance.
          </p>
        </div>
        <DashboardActions
          key={`${tenantId}:${selectedMode}`}
          customers={customers}
          hasEboekhoudenConnection={hasEboekhoudenConnection}
        />
      </header>

      <DashboardRevenue
        key={`${tenantId}:${selectedMode}`}
        revenues={revenues}
        isTestMode={selectedMode === "test"}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          {
            title: "Customers",
            value: customers.length,
            description: `${newCustomers} added this month`,
            icon: Users,
            href: "/customers",
          },
          {
            title: "Active subscriptions",
            value: activeSubscriptions,
            description: "Currently recurring",
            icon: CheckCircle2,
            href: "/customers?view=active",
          },
          {
            title: "Awaiting activation",
            value: awaitingActivation,
            description: "Customers still getting started",
            icon: CreditCard,
            href: "/customers?view=setup",
          },
        ].map((metric) => (
          <Link
            key={metric.title}
            href={metric.href}
            className="group rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <Card className="h-full transition-colors hover:bg-muted/40">
              <CardContent className="p-5">
                <div className="flex items-center justify-between gap-2 text-muted-foreground">
                  <span className="text-sm">{metric.title}</span>
                  <metric.icon className="h-4 w-4" />
                </div>
                <p className="mt-3 text-3xl font-semibold tracking-tight tabular-nums">
                  {metric.value}
                </p>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    {metric.description}
                  </p>
                  <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground transition-colors group-hover:text-foreground" />
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
            <CardTitle>Needs attention</CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link href="/notifications">
                View all <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {attentionItems.length === 0 ? (
              <div className="flex items-start gap-3 rounded-md border border-dashed bg-muted/30 p-5">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">You’re all caught up</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    No payment or subscription issues need your attention.
                  </p>
                </div>
              </div>
            ) : (
              <div className="divide-y">
                {attentionItems.map((item) => {
                  const external = [
                    "mollie_payment_methods_required",
                    "mollie_invoicing_required",
                  ].includes(item.itemType);
                  const action = external
                    ? "Open Mollie"
                    : item.type === "payment"
                      ? "Review payment"
                      : item.type === "customer" || item.type === "subscription"
                        ? "Review customer"
                        : "Review issue";
                  const impact = getNeedsAttentionImpact(item);
                  return (
                    <div key={item.id} className="py-4 first:pt-0 last:pb-0">
                      <div className="flex items-start gap-3">
                        <AlertTriangle
                          className={`mt-0.5 h-4 w-4 shrink-0 ${item.severity === "critical" ? "text-destructive" : "text-muted-foreground"}`}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-sm font-medium">
                              {item.title}
                            </h3>
                            {item.severity === "critical" && (
                              <Badge variant="destructive">Critical</Badge>
                            )}
                          </div>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">
                            {item.message}
                          </p>
                          <p className="mt-2 text-xs leading-5">
                            {item.recommendedAction}
                          </p>
                          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                            <span
                              className="text-xs text-muted-foreground"
                              title={impact.description}
                            >
                              {impact.label}
                            </span>
                            <Button asChild variant="secondary" size="sm">
                              <Link
                                href={item.href}
                                rel={external ? "noreferrer" : undefined}
                                target={external ? "_blank" : undefined}
                              >
                                {action}
                                <ArrowUpRight className="h-3.5 w-3.5" />
                              </Link>
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
            <p className="text-xs text-muted-foreground">
              The latest updates across your account.
            </p>
          </CardHeader>
          <CardContent>
            {activity.length === 0 ? (
              <div className="flex items-start gap-3 rounded-md border border-dashed p-5">
                <Activity className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">A fresh start</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Customer, payment and subscription updates will appear here.
                  </p>
                </div>
              </div>
            ) : (
              <ol>
                {activity.slice(0, 6).map((item, index, recent) => {
                  const Icon =
                    item.outcome === "failure"
                      ? AlertTriangle
                      : item.entityType === "payment"
                        ? CreditCard
                        : item.entityType === "customer"
                          ? Users
                          : item.entityType === "invoice"
                            ? FileText
                            : Activity;
                  return (
                    <li
                      key={item.id}
                      className="relative flex gap-3 pb-5 last:pb-0"
                    >
                      {index < recent.length - 1 && (
                        <span
                          aria-hidden="true"
                          className="absolute top-8 bottom-0 left-4 border-l"
                        />
                      )}
                      <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-muted/40">
                        <Icon
                          className={`h-3.5 w-3.5 ${item.outcome === "failure" ? "text-destructive" : "text-muted-foreground"}`}
                        />
                      </span>
                      <div className="min-w-0 pt-0.5">
                        <p className="text-sm leading-5 break-words">
                          {item.summary}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {formatDateTime(item.createdAt)}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
