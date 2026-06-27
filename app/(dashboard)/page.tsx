import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle, CreditCard, DollarSign, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSelectedMollieMode } from "@/lib/dashboard-mode";
import { formatCurrency, formatDateTime } from "@/lib/format";
import {
  getNeedsAttentionImpact,
  getNeedsAttentionPriorityMeta,
} from "@/lib/needs-attention-presentation";
import { listCustomers, listPayments } from "@/lib/onboarding/data";
import { getCurrentTenantSelectionForViewer } from "@/lib/tenant-context";
import { listRecentAuditActivity } from "@/lib/reliability/data";
import { listNeedsAttentionItems } from "@/lib/reliability/needs-attention";
import {
  toUiActivityRecord,
  toUiAttentionRecord,
  toUiCustomerRecord,
  toUiPaymentRecord,
} from "@/lib/ui-data";

export default async function OverviewPage() {
  const { currentTenant } = await getCurrentTenantSelectionForViewer();
  const selectedMode = await getSelectedMollieMode();
  const tenantId = currentTenant.id;
  const [customersResult, paymentsResult, activityResult, attentionResult] = await Promise.all([
    listCustomers({ mode: selectedMode, tenantId }),
    listPayments({ mode: selectedMode, tenantId }),
    listRecentAuditActivity({ mode: selectedMode, tenantId }),
    listNeedsAttentionItems({ limit: 6, mode: selectedMode, tenantId }),
  ]);

  const customers = customersResult.map(toUiCustomerRecord);
  const payments = paymentsResult.map(toUiPaymentRecord);
  const activity = activityResult.map(toUiActivityRecord);
  const attentionItems = attentionResult.map(toUiAttentionRecord);
  const groupedAttentionItems = (["critical", "warning"] as const)
    .map((severity) => ({
      items: attentionItems.filter((item) => item.severity === severity),
      severity,
    }))
    .filter((group) => group.items.length > 0);

  const totalCustomers = customers.length;
  const pendingPayments = customers.filter((customer) => {
    if (customer.latestSubscriptionStatus === "active") {
      return false;
    }

    return customer.latestFirstPaymentStatus !== "paid";
  }).length;
  const activeSubscriptions = customers.filter(
    (customer) => customer.latestSubscriptionStatus === "active",
  ).length;
  const totalRevenue = payments
    .filter((payment) => payment.status === "paid")
    .reduce((sum, payment) => sum + Number(payment.amount), 0);

  return (
    <div className="p-8 space-y-8 max-w-6xl mx-auto">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
        <p className="text-muted-foreground mt-2">Overview of your subscription metrics.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Customers</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalCustomers}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending Payments</CardTitle>
            <CreditCard className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{pendingPayments}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Subscriptions</CardTitle>
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeSubscriptions}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totalRevenue)}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle>Needs Attention</CardTitle>
            <p className="mt-2 text-sm text-muted-foreground">
              Review these before taking payment or subscription action.
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/notifications">View all</Link>
          </Button>
        </CardHeader>
        <CardContent>
          {attentionItems.length === 0 ? (
            <div className="flex items-center gap-3 rounded-md border border-dashed bg-muted/50 p-4 text-sm text-muted-foreground">
              <CheckCircle className="h-5 w-5 text-green-600" />
              No items need attention.
            </div>
          ) : (
            <div className="space-y-4">
              {groupedAttentionItems.map((group) => {
                const priority = getNeedsAttentionPriorityMeta(group.severity);

                return (
                  <div key={group.severity} className="rounded-md border">
                    <div className="border-b bg-muted/30 px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={
                            group.severity === "critical" ? "destructive" : "secondary"
                          }
                        >
                          {group.items.length}
                        </Badge>
                        <p className="font-medium">{priority.title}</p>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {priority.description}
                      </p>
                    </div>
                    <div className="divide-y">
                      {group.items.map((item) => {
                        const impact = getNeedsAttentionImpact(item);

                        return (
                          <div
                            key={item.id}
                            className="grid gap-3 p-4 md:grid-cols-[1fr_auto] md:items-center"
                          >
                            <div className="min-w-0 space-y-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <AlertTriangle
                                  className={
                                    item.severity === "critical"
                                      ? "h-4 w-4 text-destructive"
                                      : "h-4 w-4 text-orange-500"
                                  }
                                />
                                <p className="font-medium">{item.title}</p>
                                <Badge variant="outline">{impact.label}</Badge>
                              </div>
                              <p className="text-sm text-muted-foreground">{item.message}</p>
                              <p className="text-xs text-muted-foreground">
                                {impact.description}
                              </p>
                              <p className="text-sm">{item.recommendedAction}</p>
                            </div>
                            <Button asChild variant="secondary" size="sm">
                              <Link href={item.href}>
                                Open
                                <ArrowRight className="h-4 w-4" />
                              </Link>
                            </Button>
                          </div>
                        );
                      })}
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
          <CardTitle>Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-8">
            {activity.length === 0 ? (
              <p className="text-sm text-muted-foreground">No recent activity.</p>
            ) : (
              activity.map((item) => (
                <div key={item.id} className="flex items-center">
                  <div className="ml-4 space-y-1">
                    <p className="text-sm font-medium leading-none">{item.summary}</p>
                    <p className="text-sm text-muted-foreground">
                      {formatDateTime(item.createdAt)}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
