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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
  type: "payment" | "subscription" | "system";
};

type ReadFilter = "all" | "unread" | "read";
type TypeFilter = "all" | "payment" | "subscription" | "system";

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
  if (alert.severity === "critical") {
    return {
      borderClass: "border-l-destructive",
      ctaText: alert.type === "payment" ? "Review payment" : "Review subscription",
      icon: <XCircle className="h-5 w-5 text-destructive" />,
    };
  }

  return {
    borderClass: "border-l-orange-500",
    ctaText:
      alert.type === "payment"
        ? "Open payment"
        : alert.type === "subscription"
          ? "Open customer"
          : "Open settings",
    icon: <AlertTriangle className="h-5 w-5 text-orange-500" />,
  };
}

export function NotificationsWorkspace({
  alerts,
  attentionAlerts,
  error,
  notice,
}: Readonly<{
  alerts: AlertRecord[];
  attentionAlerts: AttentionRecord[];
  error?: string | null;
  notice?: string | null;
}>) {
  const pathname = usePathname();
  const [readFilter, setReadFilter] = useState<ReadFilter>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [currentPage, setCurrentPage] = useState(1);
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

  return (
    <div className="p-8 space-y-8 max-w-6xl mx-auto pb-20">
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
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {attentionAlerts.map((alert) => {
                const meta = getAttentionMeta(alert);

                return (
                  <div
                    key={alert.id}
                    className={`flex flex-col justify-between p-4 rounded-lg border bg-card shadow-sm border-l-4 ${meta.borderClass}`}
                  >
                    <div className="space-y-2 mb-4">
                      <div className="flex items-center gap-2">
                        {meta.icon}
                        <h4 className="font-semibold text-sm">{alert.title}</h4>
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {alert.message}
                      </p>
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {alert.recommendedAction}
                      </p>
                    </div>
                    <Button asChild variant="secondary" size="sm" className="w-full justify-between group">
                      <Link href={alert.href}>
                        {meta.ctaText}
                        <ArrowRight className="h-4 w-4 opacity-50 transition-opacity group-hover:opacity-100" />
                      </Link>
                    </Button>
                  </div>
                );
              })}
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
