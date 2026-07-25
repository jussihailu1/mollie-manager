"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle,
  Eye,
  EyeOff,
  Info,
  X,
  XCircle,
} from "lucide-react";

import {
  markAllAlertsReadAction,
  openAlertAction,
  setAlertStatusAction,
} from "@/lib/reliability/actions";
import { withdrawOperationRequestAction } from "@/lib/operations/actions";
import { transitionOperationRequestAction } from "@/lib/operations/actions";
import {
  getNeedsAttentionImpact,
  getNeedsAttentionPriorityMeta,
} from "@/lib/needs-attention-presentation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDate, formatDateTime } from "@/lib/format";

type AlertRecord = {
  createdAt: string;
  customerId: string | null;
  href: string;
  id: string;
  message: string;
  read: boolean;
  severity: "critical" | "warning" | "info";
  status: "acknowledged" | "open" | "resolved";
  title: string;
  type: "payment" | "subscription" | "system";
};

type AttentionRecord = {
  createdAt: string;
  customerId: string | null;
  href: string;
  id: string;
  itemType: string;
  message: string;
  recommendedAction: string;
  severity: "critical" | "warning";
  title: string;
  type: "customer" | "payment" | "subscription" | "system";
};

type PaymentFollowUpRecord = {
  alertId: string | null;
  attemptCount: number;
  createdAt: string;
  customerId: string | null;
  customerName: string | null;
  href: string;
  id: string;
  notificationLabel: string;
  notificationOccurredAt: string | null;
  notificationStatus:
    | "customer_notified"
    | "delivery_failed"
    | "delivery_in_progress"
    | "delivery_skipped"
    | "no_delivery_evidence";
  recommendedAction: string;
  taskLabel: string;
  taskStatus: "completed" | "operator_work" | "untracked";
  urgency: "high" | "medium" | "none";
};

type PendingOperationRequestRecord = {
  cancellationEffect: "immediate" | "end_of_paid_period";
  createdAt: string;
  customerId: string | null;
  customerName: string | null;
  href: string;
  id: string;
  operation: "cancel" | "pause" | "resume";
  paidPeriodEndAt: string | null;
  recommendedAction: string;
  requestedEffectiveAt: string;
  status: "pending" | "processing" | "scheduled";
  summary: string;
  subscriptionId: string;
  title: string;
};

type ReadFilter = "all" | "unread" | "read";
type TypeFilter = "all" | "customer" | "payment" | "subscription" | "system";
type FollowUpTaskFilter = "all" | "completed" | "needs_follow_up";
type FollowUpDeliveryFilter = "all" | PaymentFollowUpRecord["notificationStatus"];

function getOperationRequestTransitionControls(
  status: PendingOperationRequestRecord["status"],
) {
  if (status === "pending") {
    return [
      { label: "Mark scheduled", targetStatus: "scheduled" as const },
      { label: "Start processing", targetStatus: "processing" as const },
    ];
  }

  if (status === "scheduled") {
    return [{ label: "Start processing", targetStatus: "processing" as const }];
  }

  return [{ label: "Return to scheduled", targetStatus: "scheduled" as const }];
}

function getRelativeTime(dateString: string) {
  const date = new Date(dateString);
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffInSeconds < 60) return "just now";

  const diffInMinutes = Math.floor(diffInSeconds / 60);
  if (diffInMinutes < 60) return `${diffInMinutes}m ago`;

  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) return `${diffInHours}h ago`;

  const diffInDays = Math.floor(diffInHours / 24);
  if (diffInDays < 7) return `${diffInDays}d ago`;

  const diffInWeeks = Math.floor(diffInDays / 7);
  if (diffInWeeks < 4) return `${diffInWeeks}w ago`;

  return formatDate(dateString);
}

function getNotificationIcon(alert: AlertRecord) {
  if (alert.severity === "critical") {
    return <XCircle className="h-5 w-5 text-destructive" />;
  }

  if (alert.severity === "warning") {
    return <AlertTriangle className="h-5 w-5 text-orange-500" />;
  }

  if (alert.type === "system") {
    return <Info className="h-5 w-5 text-blue-500" />;
  }

  return <CheckCircle className="h-5 w-5 text-green-500" />;
}

function getAttentionMeta(alert: AttentionRecord) {
  if (["mollie_payment_methods_required", "mollie_invoicing_required"].includes(alert.itemType)) {
    return {
      borderClass: "border-l-orange-500",
      ctaText: "Open Mollie Dashboard",
      icon: <AlertTriangle className="h-5 w-5 text-orange-500" />,
    };
  }

  if (alert.severity === "critical") {
    return {
      borderClass: "border-l-destructive",
      ctaText:
        alert.type === "payment"
          ? "Review payment"
          : alert.type === "system"
            ? "Open settings"
            : "Review customer",
      icon: <XCircle className="h-5 w-5 text-destructive" />,
    };
  }

  return {
    borderClass: "border-l-orange-500",
    ctaText:
      alert.type === "payment"
        ? "Open payment"
        : alert.type === "subscription" || alert.type === "customer"
          ? "Open customer"
          : "Open settings",
    icon: <AlertTriangle className="h-5 w-5 text-orange-500" />,
  };
}

export function NotificationsWorkspace({
  alerts,
  attentionAlerts,
  paymentFollowUps,
  pendingOperationRequests,
}: Readonly<{
  alerts: AlertRecord[];
  attentionAlerts: AttentionRecord[];
  paymentFollowUps: PaymentFollowUpRecord[];
  pendingOperationRequests: PendingOperationRequestRecord[];
}>) {
  const pathname = usePathname();
  const [readFilter, setReadFilter] = useState<ReadFilter>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [followUpTaskFilter, setFollowUpTaskFilter] =
    useState<FollowUpTaskFilter>("needs_follow_up");
  const [followUpDeliveryFilter, setFollowUpDeliveryFilter] =
    useState<FollowUpDeliveryFilter>("all");
  const itemsPerPage = 10;
  const unreadCount = alerts.filter((alert) => !alert.read).length;

  const filteredNotifications = useMemo(() => {
    let result = [...alerts];

    if (readFilter === "unread") {
      result = result.filter((alert) => !alert.read);
    } else if (readFilter === "read") {
      result = result.filter((alert) => alert.read);
    }

    if (typeFilter !== "all") {
      result = result.filter((alert) => alert.type === typeFilter);
    }

    result.sort(
      (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
    );

    return result;
  }, [alerts, readFilter, typeFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredNotifications.length / itemsPerPage));
  const paginatedNotifications = filteredNotifications.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage,
  );
  const filteredPaymentFollowUps = useMemo(
    () =>
      paymentFollowUps.filter(
        (item) =>
          (followUpTaskFilter === "all" ||
            (followUpTaskFilter === "completed"
              ? item.taskStatus === "completed"
              : item.taskStatus !== "completed")) &&
          (followUpDeliveryFilter === "all" ||
            item.notificationStatus === followUpDeliveryFilter),
      ),
    [followUpDeliveryFilter, followUpTaskFilter, paymentFollowUps],
  );
  const openFollowUpCount = paymentFollowUps.filter(
    (item) => item.taskStatus !== "completed",
  ).length;
  const openOperationRequestCount = pendingOperationRequests.length;
  const groupedAttentionAlerts = useMemo(
    () =>
      (["critical", "warning"] as const)
        .map((severity) => ({
          items: attentionAlerts.filter((alert) => alert.severity === severity),
          severity,
        }))
        .filter((group) => group.items.length > 0),
    [attentionAlerts],
  );

  return (
    <div className="p-8 space-y-8 max-w-6xl mx-auto pb-20">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Notifications</h2>
          <p className="text-muted-foreground mt-2">
            Stay on top of payments, subscriptions, and system alerts.
          </p>
        </div>
        {unreadCount > 0 ? (
          <form action={markAllAlertsReadAction}>
            <input type="hidden" name="returnTo" value={pathname} />
            <Button variant="outline">Mark All as Read</Button>
          </form>
        ) : null}
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              Requires Attention
              {attentionAlerts.length > 0 ? (
                <Badge variant="destructive" className="rounded-full px-2">
                  {attentionAlerts.length}
                </Badge>
              ) : null}
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {attentionAlerts.length === 0 ? (
            <div className="flex items-center gap-3 text-muted-foreground bg-muted/50 p-4 rounded-lg border border-dashed">
              <CheckCircle className="h-5 w-5 text-green-500" />
              <p className="text-sm">
                Everything looks good - no issues require your attention.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {groupedAttentionAlerts.map((group) => {
                const priority = getNeedsAttentionPriorityMeta(group.severity);

                return (
                  <div className="rounded-lg border" key={group.severity}>
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
                    <div className="grid gap-3 p-3 md:grid-cols-2 lg:grid-cols-3">
                      {group.items.map((alert) => {
                        const impact = getNeedsAttentionImpact(alert);
                        const meta = getAttentionMeta(alert);

                        return (
                          <div
                            key={alert.id}
                            className={`flex flex-col justify-between rounded-lg border bg-card p-4 shadow-sm border-l-4 ${meta.borderClass}`}
                          >
                            <div className="mb-4 space-y-2">
                              <div className="flex items-center gap-2">
                                {meta.icon}
                                <h4 className="font-semibold text-sm">{alert.title}</h4>
                              </div>
                              <Badge variant="outline" className="w-fit">
                                {impact.label}
                              </Badge>
                              <p className="text-sm text-muted-foreground line-clamp-2">
                                {alert.message}
                              </p>
                              <p className="text-xs text-muted-foreground line-clamp-2">
                                {impact.description}
                              </p>
                              <p className="text-xs text-muted-foreground line-clamp-2">
                                {alert.recommendedAction}
                              </p>
                            </div>
                            <Button
                              asChild
                              variant="secondary"
                              size="sm"
                              className="w-full justify-between group"
                            >
                              <Link
                                href={alert.href}
                                rel={["mollie_payment_methods_required", "mollie_invoicing_required"].includes(alert.itemType) ? "noreferrer" : undefined}
                                target={["mollie_payment_methods_required", "mollie_invoicing_required"].includes(alert.itemType) ? "_blank" : undefined}
                              >
                                {meta.ctaText}
                                <ArrowRight className="h-4 w-4 opacity-50 transition-opacity group-hover:opacity-100" />
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
        <CardHeader className="pb-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2 text-lg">
                Payment follow-up queue
                {openFollowUpCount > 0 ? (
                  <Badge variant="destructive">{openFollowUpCount}</Badge>
                ) : null}
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Durable operator task and customer notification evidence for failed payments.
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Select
                value={followUpTaskFilter}
                onValueChange={(value) =>
                  setFollowUpTaskFilter(value as FollowUpTaskFilter)
                }
              >
                <SelectTrigger className="w-full sm:w-44">
                  <SelectValue placeholder="Task status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All tasks</SelectItem>
                  <SelectItem value="needs_follow_up">Needs follow-up</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={followUpDeliveryFilter}
                onValueChange={(value) =>
                  setFollowUpDeliveryFilter(value as FollowUpDeliveryFilter)
                }
              >
                <SelectTrigger className="w-full sm:w-48">
                  <SelectValue placeholder="Notification status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All notifications</SelectItem>
                  <SelectItem value="customer_notified">Customer notified</SelectItem>
                  <SelectItem value="delivery_in_progress">In progress</SelectItem>
                  <SelectItem value="delivery_failed">Failed</SelectItem>
                  <SelectItem value="delivery_skipped">Skipped</SelectItem>
                  <SelectItem value="no_delivery_evidence">Not recorded</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filteredPaymentFollowUps.length === 0 ? (
            <div className="rounded-lg border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
              No failed-payment follow-ups match these filters.
            </div>
          ) : (
            <div className="divide-y rounded-md border">
              {filteredPaymentFollowUps.map((item) => (
                <div
                  className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center"
                  key={item.id}
                >
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">
                        {item.customerName ?? "Customer payment"}
                      </p>
                      <Badge
                        variant={item.urgency === "high" ? "destructive" : "outline"}
                      >
                        {item.taskLabel}
                      </Badge>
                      <Badge variant="secondary">{item.notificationLabel}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {item.recommendedAction}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Payment issue {formatDateTime(item.createdAt)}
                      {item.notificationOccurredAt
                        ? ` / Notification updated ${formatDateTime(item.notificationOccurredAt)}`
                        : " / No notification timestamp"}
                      {item.attemptCount > 0
                        ? ` / ${item.attemptCount} delivery attempt${item.attemptCount === 1 ? "" : "s"}`
                        : ""}
                    </p>
                  </div>
                  <Button asChild size="sm" variant="outline">
                    <Link href={item.href}>
                      Review payment
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-4">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-lg">
              Pending subscription requests
              {openOperationRequestCount > 0 ? (
                <Badge variant="secondary">{openOperationRequestCount}</Badge>
              ) : null}
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Recorded lifecycle requests awaiting manual review or future execution.
            </p>
          </div>
        </CardHeader>
        <CardContent>
          {pendingOperationRequests.length === 0 ? (
            <div className="rounded-lg border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
              No pending subscription requests.
            </div>
          ) : (
            <div className="divide-y rounded-md border">
              {pendingOperationRequests.map((request) => (
                <div
                  className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center"
                  key={request.id}
                >
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">
                        {request.customerName ?? "Customer subscription"}
                      </p>
                      <Badge variant="outline">{request.title}</Badge>
                      <Badge
                        variant={
                          request.status === "processing" ? "destructive" : "secondary"
                        }
                      >
                        {request.status}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{request.summary}</p>
                    <p className="text-sm text-muted-foreground">
                      Effective {formatDate(request.requestedEffectiveAt)} / Service{" "}
                      {request.cancellationEffect === "immediate"
                        ? "ends immediately"
                        : `kept through ${formatDate(request.paidPeriodEndAt)}`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Recorded {formatDateTime(request.createdAt)} / {request.recommendedAction}
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    {getOperationRequestTransitionControls(request.status).map((control) => (
                      <form action={transitionOperationRequestAction} key={control.targetStatus}>
                        <input type="hidden" name="operationRequestId" value={request.id} />
                        <input type="hidden" name="returnTo" value={pathname} />
                        <input
                          type="hidden"
                          name="targetStatus"
                          value={control.targetStatus}
                        />
                        <Button size="sm" type="submit" variant="outline">
                          {control.label}
                        </Button>
                      </form>
                    ))}
                    <form action={withdrawOperationRequestAction}>
                      <input type="hidden" name="operationRequestId" value={request.id} />
                      <input type="hidden" name="returnTo" value={pathname} />
                      <Button size="sm" type="submit" variant="outline">
                        Withdraw request
                      </Button>
                    </form>
                    <Button asChild size="sm" variant="outline">
                      <Link href={request.href}>
                        Open customer
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center p-1 bg-muted rounded-lg">
          <Button
            variant={readFilter === "all" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => {
              setReadFilter("all");
              setCurrentPage(1);
            }}
            className="px-4"
          >
            All
          </Button>
          <Button
            variant={readFilter === "unread" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => {
              setReadFilter("unread");
              setCurrentPage(1);
            }}
            className="px-4"
          >
            Unread
          </Button>
          <Button
            variant={readFilter === "read" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => {
              setReadFilter("read");
              setCurrentPage(1);
            }}
            className="px-4"
          >
            Read
          </Button>
        </div>

        <Select
          value={typeFilter}
          onValueChange={(value) => {
            setTypeFilter(value as TypeFilter);
            setCurrentPage(1);
          }}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Filter by type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="customer">Customers</SelectItem>
            <SelectItem value="payment">Payments</SelectItem>
            <SelectItem value="subscription">Subscriptions</SelectItem>
            <SelectItem value="system">System Alerts</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="border rounded-md bg-card divide-y">
        {paginatedNotifications.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            {alerts.length === 0 ? "No notifications yet." : "No notifications match your filters."}
          </div>
        ) : (
          paginatedNotifications.map((alert) => (
            <div
              key={alert.id}
              className={`group flex items-start gap-4 p-4 transition-colors hover:bg-accent/50 ${!alert.read ? "bg-accent/30" : ""}`}
            >
              <div className="mt-1 shrink-0 relative">
                {getNotificationIcon(alert)}
                {!alert.read ? (
                  <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-primary border-2 border-background" />
                ) : null}
              </div>

              <form action={openAlertAction} className="flex-1 space-y-1 cursor-pointer">
                <input type="hidden" name="alertId" value={alert.id} />
                <input type="hidden" name="redirectTo" value={alert.href} />
                <button type="submit" className="w-full text-left">
                  <div className="flex items-center justify-between gap-2">
                    <p
                      className={`text-sm ${!alert.read ? "font-semibold text-foreground" : "font-medium text-foreground/90"}`}
                    >
                      {alert.title}
                    </p>
                    <span
                      className="text-xs text-muted-foreground whitespace-nowrap"
                      title={formatDateTime(alert.createdAt)}
                    >
                      {getRelativeTime(alert.createdAt)}
                    </span>
                  </div>
                  <p
                    className={`text-sm line-clamp-2 ${!alert.read ? "text-foreground/80" : "text-muted-foreground"}`}
                  >
                    {alert.message}
                  </p>
                </button>
              </form>

              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-2">
                <form action={setAlertStatusAction}>
                  <input type="hidden" name="alertId" value={alert.id} />
                  <input type="hidden" name="returnTo" value={pathname} />
                  <input
                    type="hidden"
                    name="status"
                    value={alert.read ? "open" : "acknowledged"}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-foreground"
                    title={alert.read ? "Mark as unread" : "Mark as read"}
                  >
                    {alert.read ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </Button>
                </form>
                <form action={setAlertStatusAction}>
                  <input type="hidden" name="alertId" value={alert.id} />
                  <input type="hidden" name="returnTo" value={pathname} />
                  <input type="hidden" name="status" value="resolved" />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    title="Dismiss notification"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </form>
              </div>
            </div>
          ))
        )}
      </div>

      {totalPages > 1 ? (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {(currentPage - 1) * itemsPerPage + 1} to{" "}
            {Math.min(currentPage * itemsPerPage, filteredNotifications.length)} of{" "}
            {filteredNotifications.length} notifications
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((current) => Math.max(1, current - 1))}
              disabled={currentPage === 1}
            >
              Previous
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {currentPage} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((current) => Math.min(totalPages, current + 1))}
              disabled={currentPage === totalPages}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
