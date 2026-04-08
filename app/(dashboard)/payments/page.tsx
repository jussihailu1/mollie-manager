import Link from "next/link";

import { DataTable } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { FilterBar } from "@/components/filter-bar";
import { FlashMessage } from "@/components/flash-message";
import { KpiStrip } from "@/components/kpi-strip";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import {
  getSelectedMollieMode,
  resolveDashboardModeFilter,
} from "@/lib/dashboard-mode";
import {
  formatCurrency,
  formatDateTime,
  formatLabel,
  getSingleSearchParam,
} from "@/lib/format";
import { listPayments } from "@/lib/onboarding/data";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function PaymentsPage({
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
  const payments = await listPayments({ mode: effectiveModeFilter });
  const notice = getSingleSearchParam(resolvedSearchParams.notice);
  const error = getSingleSearchParam(resolvedSearchParams.error);
  const focusId = getSingleSearchParam(resolvedSearchParams.focus);
  const query = (getSingleSearchParam(resolvedSearchParams.q) ?? "").trim();
  const statusFilter = getSingleSearchParam(resolvedSearchParams.status) ?? "";
  const typeFilter = getSingleSearchParam(resolvedSearchParams.type) ?? "";

  const filteredPayments = payments.filter((payment) => {
    const searchHaystack = [
      payment.customerName,
      payment.customerEmail,
      payment.subscriptionDescription,
      payment.molliePaymentId,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    const matchesQuery =
      query.length === 0 || searchHaystack.includes(query.toLowerCase());
    const matchesStatus =
      statusFilter.length === 0 || payment.mollieStatus === statusFilter;
    const matchesType =
      typeFilter.length === 0 || payment.paymentType === typeFilter;

    return matchesQuery && matchesStatus && matchesType;
  });

  const paidCount = payments.filter((payment) => payment.mollieStatus === "paid").length;
  const failedCount = payments.filter((payment) =>
    ["failed", "expired"].includes(payment.mollieStatus ?? ""),
  ).length;
  const recurringCount = payments.filter(
    (payment) => payment.paymentType === "recurring",
  ).length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Payments"
        title="Inspect the operational payment ledger"
        description="The table below reflects the local operational store. Use it to trace first payments, recurring charges, and any exception that needs follow-up."
        actions={
          <Link
            href="/subscriptions"
            className="inline-flex min-h-10 items-center justify-center rounded-xl border border-border-strong bg-surface px-3.5 py-2 text-sm font-medium text-ink-soft transition-colors hover:bg-surface-muted hover:text-ink"
          >
            Open subscriptions
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
          { label: "Stored payments", value: payments.length },
          {
            label: "Paid",
            value: paidCount,
            helper: paidCount > 0 ? "settled" : "none",
            tone: paidCount > 0 ? "accent" : "neutral",
          },
          {
            label: "Failures",
            value: failedCount,
            helper: failedCount > 0 ? "needs review" : "clear",
            tone: failedCount > 0 ? "warning" : "neutral",
          },
          {
            label: "Recurring",
            value: recurringCount,
            helper: recurringCount > 0 ? "subscription-born" : "none",
            tone: recurringCount > 0 ? "accent" : "neutral",
          },
        ]}
      />

      <FilterBar
        resetHref="/payments"
        searchPlaceholder="Search by customer, subscription, or Mollie payment ID"
        searchValue={query}
        filters={[
          {
            label: "Status",
            name: "status",
            value: statusFilter,
            options: [
              { label: "All statuses", value: "" },
              { label: "Paid", value: "paid" },
              { label: "Open", value: "open" },
              { label: "Pending", value: "pending" },
              { label: "Failed", value: "failed" },
              { label: "Expired", value: "expired" },
            ],
          },
          {
            label: "Type",
            name: "type",
            value: typeFilter,
            options: [
              { label: "All types", value: "" },
              { label: "First", value: "first" },
              { label: "Recurring", value: "recurring" },
              { label: "Manual", value: "manual" },
              { label: "Refund", value: "refund" },
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

      {filteredPayments.length === 0 ? (
        <EmptyState
          title="No matching payments"
          description="Adjust the filters or sync a subscription if you expect recurring payments to appear here."
        />
      ) : (
        <DataTable
          columns={[
            { label: "Payment" },
            { label: "Customer" },
            { label: "Status" },
            { label: "Timeline" },
            { label: "Subscription" },
            { label: "Actions", align: "right", className: "w-[220px]" },
          ]}
        >
          {filteredPayments.map((payment) => {
            const tone =
              payment.mollieStatus === "paid"
                ? "accent"
                : payment.mollieStatus === "failed" ||
                    payment.mollieStatus === "expired"
                  ? "warning"
                  : "muted";

            return (
              <tr
                key={payment.id}
                className={`align-top ${
                  focusId === payment.id
                    ? "bg-accent-soft/55"
                    : payment.mollieStatus === "failed" ||
                        payment.mollieStatus === "expired"
                      ? "bg-warning-soft/40"
                      : ""
                }`}
              >
                <td className="px-4 py-4">
                  <p className="text-sm font-semibold text-ink">
                    {formatCurrency(payment.amountValue, payment.amountCurrency)}
                  </p>
                  <p className="mt-1 text-xs text-ink-soft">
                    {payment.molliePaymentId ?? "No Mollie ID stored"}
                  </p>
                  <p className="mt-1 text-xs text-ink-soft">
                    {formatLabel(payment.paymentType)}
                  </p>
                </td>
                <td className="px-4 py-4">
                  <p className="text-sm font-medium text-ink">
                    {payment.customerName ?? "Unknown customer"}
                  </p>
                  <p className="mt-1 text-sm text-ink-soft">
                    {payment.customerEmail ?? "No email stored"}
                  </p>
                </td>
                <td className="px-4 py-4">
                  <div className="flex flex-col gap-2">
                    <StatusPill tone={tone}>{formatLabel(payment.mollieStatus)}</StatusPill>
                    <StatusPill
                      tone={payment.mode === "live" ? "warning" : "muted"}
                    >
                      {payment.mode}
                    </StatusPill>
                  </div>
                </td>
                <td className="px-4 py-4">
                  <p className="text-sm text-ink">
                    Created {formatDateTime(payment.createdAt)}
                  </p>
                  <p className="mt-1 text-xs text-ink-soft">
                    Paid {formatDateTime(payment.paidAt)}
                  </p>
                  <p className="mt-1 text-xs text-ink-soft">
                    Failed {formatDateTime(payment.failedAt)}
                  </p>
                </td>
                <td className="px-4 py-4">
                  <p className="text-sm font-medium text-ink">
                    {payment.subscriptionDescription ?? "Standalone"}
                  </p>
                  <p className="mt-1 text-xs text-ink-soft">
                    {formatLabel(payment.method)}
                  </p>
                </td>
                <td className="px-4 py-4">
                  <div className="flex flex-wrap justify-end gap-2">
                    {payment.customerId ? (
                      <Link
                        href={`/customers/${payment.customerId}`}
                        className="inline-flex min-h-9 items-center justify-center rounded-lg border border-border-strong px-3 py-1.5 text-sm font-medium text-ink-soft transition-colors hover:bg-surface-muted hover:text-ink"
                      >
                        Customer
                      </Link>
                    ) : null}
                    {payment.subscriptionId ? (
                      <Link
                        href={`/subscriptions?focus=${payment.subscriptionId}`}
                        className="inline-flex min-h-9 items-center justify-center rounded-lg border border-border-strong px-3 py-1.5 text-sm font-medium text-ink-soft transition-colors hover:bg-surface-muted hover:text-ink"
                      >
                        Subscription
                      </Link>
                    ) : null}
                    {payment.checkoutUrl ? (
                      <a
                        href={payment.checkoutUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex min-h-9 items-center justify-center rounded-lg bg-ink px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-ink/88"
                      >
                        Checkout
                      </a>
                    ) : null}
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
