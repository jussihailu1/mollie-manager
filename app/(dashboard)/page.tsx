import { CheckCircle, CreditCard, DollarSign, Users } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSelectedMollieMode } from "@/lib/dashboard-mode";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { listCustomers, listPayments } from "@/lib/onboarding/data";
import { listRecentAuditActivity } from "@/lib/reliability/data";
import {
  toUiActivityRecord,
  toUiCustomerRecord,
  toUiPaymentRecord,
} from "@/lib/ui-data";

export default async function OverviewPage() {
  const selectedMode = await getSelectedMollieMode();
  const [customersResult, paymentsResult, activityResult] = await Promise.all([
    listCustomers({ mode: selectedMode }),
    listPayments({ mode: selectedMode }),
    listRecentAuditActivity({ mode: selectedMode }),
  ]);

  const customers = customersResult.map(toUiCustomerRecord);
  const payments = paymentsResult.map(toUiPaymentRecord);
  const activity = activityResult.map(toUiActivityRecord);

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
