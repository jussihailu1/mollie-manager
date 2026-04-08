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
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  formatLabel,
  getSingleSearchParam,
} from "@/lib/format";
import { listSubscriptions } from "@/lib/onboarding/data";
import {
  cancelSubscriptionAction,
  syncSubscriptionAction,
} from "@/lib/operations/actions";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function SubscriptionsPage({
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
  const subscriptions = await listSubscriptions({ mode: effectiveModeFilter });
  const notice = getSingleSearchParam(resolvedSearchParams.notice);
  const error = getSingleSearchParam(resolvedSearchParams.error);
  const focusId = getSingleSearchParam(resolvedSearchParams.focus);
  const query = (getSingleSearchParam(resolvedSearchParams.q) ?? "").trim();
  const statusFilter = getSingleSearchParam(resolvedSearchParams.status) ?? "";

  const filteredSubscriptions = subscriptions.filter((subscription) => {
    const searchHaystack = [
      subscription.description,
      subscription.customerName,
      subscription.customerEmail,
      subscription.mollieSubscriptionId,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    const matchesQuery =
      query.length === 0 || searchHaystack.includes(query.toLowerCase());
    const matchesStatus =
      statusFilter.length === 0 || subscription.localStatus === statusFilter;

    return matchesQuery && matchesStatus;
  });

  const activeCount = subscriptions.filter(
    (subscription) => subscription.localStatus === "active",
  ).length;
  const stopQueuedCount = subscriptions.filter(
    (subscription) => subscription.stopAfterCurrentPeriod,
  ).length;
  const exceptionCount = subscriptions.filter(
    (subscription) =>
      !["active", "future_charges_stopped"].includes(subscription.localStatus),
  ).length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Subscriptions"
        title="Track recurring billing and guarded stop actions"
        description="This page stays dense and operational: current status, next charge, customer context, and the actions that should remain explicit."
        actions={
          <Link
            href="/customers"
            className="inline-flex min-h-10 items-center justify-center rounded-xl bg-ink px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-ink/88"
          >
            Create from customers
          </Link>
        }
      />

      {notice ? (
        <FlashMessage message={notice} title="Update" variant="notice" />
      ) : null}
      {error ? (
        <FlashMessage message={error} title="Action blocked" variant="error" />
      ) : null}

      <KpiStrip
        items={[
          { label: "Subscriptions", value: subscriptions.length },
          {
            label: "Active",
            value: activeCount,
            helper: activeCount > 0 ? "collecting" : "none",
            tone: activeCount > 0 ? "accent" : "neutral",
          },
          {
            label: "Future charges stopped",
            value: stopQueuedCount,
            helper: stopQueuedCount > 0 ? "reviewed" : "none",
            tone: stopQueuedCount > 0 ? "warning" : "neutral",
          },
          {
            label: "Exceptions",
            value: exceptionCount,
            helper: exceptionCount > 0 ? "needs review" : "clear",
            tone: exceptionCount > 0 ? "warning" : "neutral",
          },
        ]}
      />

      <FilterBar
        resetHref="/subscriptions"
        searchPlaceholder="Search by customer, description, or Mollie subscription ID"
        searchValue={query}
        filters={[
          {
            label: "Status",
            name: "status",
            value: statusFilter,
            options: [
              { label: "All statuses", value: "" },
              { label: "Active", value: "active" },
              { label: "Mandate pending", value: "mandate_pending" },
              { label: "Payment action required", value: "payment_action_required" },
              { label: "Future charges stopped", value: "future_charges_stopped" },
              { label: "Out of sync", value: "out_of_sync" },
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

      {filteredSubscriptions.length === 0 ? (
        <EmptyState
          title="No matching subscriptions"
          description="Adjust the filters or create the next subscription from a customer that already has a paid first payment and a ready mandate."
        />
      ) : (
        <DataTable
          columns={[
            { label: "Subscription" },
            { label: "Customer" },
            { label: "Status" },
            { label: "Next payment" },
            { label: "Amount", align: "right" },
            { label: "Actions", align: "right", className: "w-[280px]" },
          ]}
        >
          {filteredSubscriptions.map((subscription) => {
            const canStopFutureCharges =
              subscription.localStatus !== "future_charges_stopped";

            return (
              <tr
                key={subscription.id}
                className={`align-top ${
                  focusId === subscription.id ? "bg-accent-soft/55" : ""
                }`}
              >
                <td className="px-4 py-4">
                  <div className="min-w-[240px]">
                    <p className="text-sm font-semibold text-ink">
                      {subscription.description}
                    </p>
                    <p className="mt-1 text-xs text-ink-soft">
                      Started {formatDate(subscription.startDate)} - created{" "}
                      {formatDateTime(subscription.createdAt)}
                    </p>
                    {subscription.canceledAt ? (
                      <p className="mt-2 text-xs text-ink-soft">
                        Future charges stopped {formatDateTime(subscription.canceledAt)}
                      </p>
                    ) : null}
                  </div>
                </td>
                <td className="px-4 py-4">
                  <p className="text-sm font-medium text-ink">
                    {subscription.customerName ?? "Unnamed customer"}
                  </p>
                  <p className="mt-1 text-sm text-ink-soft">
                    {subscription.customerEmail}
                  </p>
                </td>
                <td className="px-4 py-4">
                  <div className="flex flex-col gap-2">
                    <StatusPill
                      tone={
                        subscription.localStatus === "active"
                          ? "accent"
                          : subscription.localStatus === "future_charges_stopped"
                            ? "warning"
                            : "muted"
                      }
                    >
                      {formatLabel(subscription.localStatus)}
                    </StatusPill>
                    <StatusPill tone="muted">
                      Mollie {formatLabel(subscription.mollieStatus)}
                    </StatusPill>
                    <StatusPill
                      tone={subscription.mode === "live" ? "warning" : "muted"}
                    >
                      {subscription.mode}
                    </StatusPill>
                  </div>
                </td>
                <td className="px-4 py-4">
                  <p className="text-sm font-medium text-ink">
                    {formatDate(subscription.nextPaymentDate)}
                  </p>
                  <p className="mt-1 text-xs text-ink-soft">
                    {subscription.interval}
                  </p>
                </td>
                <td className="px-4 py-4 text-right">
                  <p className="text-sm font-semibold text-ink">
                    {formatCurrency(
                      subscription.amountValue,
                      subscription.amountCurrency,
                    )}
                  </p>
                </td>
                <td className="px-4 py-4">
                  <div className="flex flex-wrap justify-end gap-2">
                    <Link
                      href={`/customers/${subscription.customerId}`}
                      className="inline-flex min-h-9 items-center justify-center rounded-lg border border-border-strong px-3 py-1.5 text-sm font-medium text-ink-soft transition-colors hover:bg-surface-muted hover:text-ink"
                    >
                      Customer
                    </Link>
                    <form action={syncSubscriptionAction}>
                      <input
                        type="hidden"
                        name="subscriptionId"
                        value={subscription.id}
                      />
                      <input
                        type="hidden"
                        name="returnTo"
                        value={`/subscriptions?focus=${subscription.id}`}
                      />
                      <FormActionButton variant="secondary" pendingLabel="Syncing...">
                        Sync
                      </FormActionButton>
                    </form>
                    <form action={cancelSubscriptionAction}>
                      <input
                        type="hidden"
                        name="subscriptionId"
                        value={subscription.id}
                      />
                      <input
                        type="hidden"
                        name="returnTo"
                        value={`/subscriptions?focus=${subscription.id}`}
                      />
                      <FormActionButton
                        confirmMessage="Stop future charges for this subscription in Mollie?"
                        disabled={!canStopFutureCharges}
                        pendingLabel="Stopping..."
                        variant="danger"
                      >
                        Stop
                      </FormActionButton>
                    </form>
                  </div>
                </td>
              </tr>
            );
          })}
        </DataTable>
      )}
    </div>
  );
}
