import Link from "next/link";

import { DataTable } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { FilterBar } from "@/components/filter-bar";
import { FlashMessage } from "@/components/flash-message";
import { FormActionButton } from "@/components/form-action-button";
import { KpiStrip } from "@/components/kpi-strip";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import {
  getSelectedMollieMode,
  resolveDashboardModeFilter,
} from "@/lib/dashboard-mode";
import { formatDateTime, getSingleSearchParam } from "@/lib/format";
import { sendTestAlertAction } from "@/lib/reliability/actions";
import { listAlertInbox } from "@/lib/reliability/data";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

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

function getModeTone(mode: "live" | "test" | null) {
  if (mode === "live") {
    return "warning";
  }

  if (mode === "test") {
    return "accent";
  }

  return "muted";
}

export default async function AlertsPage({
  searchParams,
}: Readonly<{
  searchParams: SearchParams;
}>) {
  const resolvedSearchParams = await searchParams;
  const selectedMode = await getSelectedMollieMode();
  const rawModeFilter = getSingleSearchParam(resolvedSearchParams.mode);
  const effectiveModeFilter = await resolveDashboardModeFilter(rawModeFilter);
  const modeFilter =
    rawModeFilter === "all" || rawModeFilter === "test" || rawModeFilter === "live"
      ? rawModeFilter
      : "";
  const alerts = await listAlertInbox({ mode: effectiveModeFilter });

  const notice = getSingleSearchParam(resolvedSearchParams.notice);
  const error = getSingleSearchParam(resolvedSearchParams.error);
  const query = (getSingleSearchParam(resolvedSearchParams.q) ?? "").trim();
  const statusFilter = getSingleSearchParam(resolvedSearchParams.status) ?? "";
  const severityFilter = getSingleSearchParam(resolvedSearchParams.severity) ?? "";

  const filteredAlerts = alerts.filter((alert) => {
    const searchHaystack = [
      alert.title,
      alert.message,
      alert.customerName,
      alert.customerEmail,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    const matchesQuery =
      query.length === 0 || searchHaystack.includes(query.toLowerCase());
    const matchesStatus = statusFilter.length === 0 || alert.status === statusFilter;
    const matchesSeverity =
      severityFilter.length === 0 || alert.severity === severityFilter;

    return matchesQuery && matchesStatus && matchesSeverity;
  });

  const openCount = alerts.filter((alert) => alert.status === "open").length;
  const criticalCount = alerts.filter(
    (alert) => alert.status === "open" && alert.severity === "critical",
  ).length;
  const unsentCount = alerts.filter((alert) => !alert.emailSentAt).length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Alerts"
        title="Triage failures, disputes, and state drift"
        description="Keep the queue dense and readable. Open the linked workspace directly from the affected record once you know what needs action."
        actions={
          <>
            <StatusPill tone={getModeTone(effectiveModeFilter === "all" ? null : effectiveModeFilter)}>
              {effectiveModeFilter === "all"
                ? "Viewing all modes"
                : `Viewing ${effectiveModeFilter} mode`}
            </StatusPill>
            <form action={sendTestAlertAction}>
              <input type="hidden" name="returnTo" value="/alerts" />
              <FormActionButton variant="secondary" pendingLabel="Sending test alert...">
                Send test alert
              </FormActionButton>
            </form>
          </>
        }
      />

      <KpiStrip
        items={[
          {
            label: "Open alerts",
            value: openCount,
            helper: openCount > 0 ? "needs review" : "clear",
            tone: openCount > 0 ? "warning" : "accent",
          },
          {
            label: "Critical",
            value: criticalCount,
            helper: criticalCount > 0 ? "priority" : "none",
            tone: criticalCount > 0 ? "warning" : "neutral",
          },
          {
            label: "Email pending",
            value: unsentCount,
            helper: unsentCount > 0 ? "check delivery" : "up to date",
            tone: unsentCount > 0 ? "warning" : "neutral",
          },
          {
            label: "Records",
            value: alerts.length,
            helper: selectedMode === effectiveModeFilter ? "default scope" : "override",
            tone: selectedMode === effectiveModeFilter ? "neutral" : "accent",
          },
        ]}
      />

      {notice ? (
        <FlashMessage message={notice} title="Update" variant="notice" />
      ) : null}
      {error ? (
        <FlashMessage message={error} title="Action blocked" variant="error" />
      ) : null}

      <FilterBar
        resetHref="/alerts"
        searchPlaceholder="Search alerts by title, message, or customer"
        searchValue={query}
        filters={[
          {
            label: "Status",
            name: "status",
            value: statusFilter,
            options: [
              { label: "All statuses", value: "" },
              { label: "Open", value: "open" },
              { label: "Acknowledged", value: "acknowledged" },
              { label: "Resolved", value: "resolved" },
            ],
          },
          {
            label: "Severity",
            name: "severity",
            value: severityFilter,
            options: [
              { label: "All severity", value: "" },
              { label: "Critical", value: "critical" },
              { label: "Warning", value: "warning" },
              { label: "Info", value: "info" },
            ],
          },
          {
            label: "Mode",
            name: "mode",
            value: modeFilter,
            options: [
              { label: `Default mode (${selectedMode})`, value: "" },
              { label: "All modes", value: "all" },
              { label: "Test", value: "test" },
              { label: "Live", value: "live" },
            ],
          },
        ]}
      />

      {filteredAlerts.length === 0 ? (
        <EmptyState
          title="No matching alerts"
          description="Adjust the filters or wait for the next operational event to land in the queue."
        />
      ) : (
        <DataTable
          columns={[
            { label: "Alert" },
            { label: "Customer" },
            { label: "Severity" },
            { label: "Status" },
            { label: "Delivery" },
            { label: "Mode" },
            { label: "Detected" },
            { label: "Actions", align: "right", className: "w-[130px]" },
          ]}
        >
          {filteredAlerts.map((alert) => (
            <tr
              key={alert.id}
              className={alert.severity === "critical" && alert.status === "open" ? "bg-critical-soft/40" : ""}
            >
              <td className="min-w-[320px]">
                <div className="flex flex-col gap-1">
                  <p className="text-sm font-semibold text-ink">{alert.title}</p>
                  <p className="text-sm leading-6 text-ink-soft">{alert.message}</p>
                </div>
              </td>
              <td>
                <div className="flex min-w-[220px] flex-col gap-1">
                  <p className="text-sm font-medium text-ink">
                    {alert.customerName ?? "Unknown customer"}
                  </p>
                  <p className="text-sm text-ink-soft">
                    {alert.customerEmail ?? "No email stored"}
                  </p>
                </div>
              </td>
              <td>
                <StatusPill tone={alert.severity === "critical" ? "critical" : "warning"}>
                  {alert.severity}
                </StatusPill>
              </td>
              <td>
                <StatusPill tone={alert.status === "open" ? "warning" : "muted"}>
                  {alert.status}
                </StatusPill>
              </td>
              <td>
                <StatusPill tone={alert.emailSentAt ? "accent" : "muted"}>
                  {alert.emailSentAt ? "sent" : "pending"}
                </StatusPill>
              </td>
              <td>
                <StatusPill tone={getModeTone(alert.mode)}>
                  {alert.mode ?? "unknown"}
                </StatusPill>
              </td>
              <td className="font-mono text-xs text-ink-soft">
                {formatDateTime(alert.createdAt)}
              </td>
              <td>
                <div className="flex justify-end">
                  <Link
                    href={getAlertHref(alert)}
                    className="inline-flex min-h-9 items-center justify-center rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-ink/88"
                  >
                    Open
                  </Link>
                </div>
              </td>
            </tr>
          ))}
        </DataTable>
      )}
    </div>
  );
}
