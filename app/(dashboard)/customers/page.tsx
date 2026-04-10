import Link from "next/link";

import { DataTable } from "@/components/data-table";
import { DrawerForm } from "@/components/drawer-form";
import { EmptyState } from "@/components/empty-state";
import { FilterBar } from "@/components/filter-bar";
import { FlashMessage } from "@/components/flash-message";
import { FormActionButton } from "@/components/form-action-button";
import { KpiStrip } from "@/components/kpi-strip";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  getSelectedMollieMode,
  resolveDashboardModeFilter,
} from "@/lib/dashboard-mode";
import {
  formatDateTime,
  formatLabel,
  getSingleSearchParam,
} from "@/lib/format";
import { createCustomerAction } from "@/lib/onboarding/actions";
import { listCustomers } from "@/lib/onboarding/data";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function getCustomerStage(customer: Awaited<ReturnType<typeof listCustomers>>[number]) {
  if (customer.latestSubscriptionStatus === "active") {
    return "active";
  }

  if (customer.latestFirstPaymentStatus === "paid" && customer.hasValidMandate) {
    return "ready";
  }

  return "setup";
}

export default async function CustomersPage({
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
  const customers = await listCustomers({ mode: effectiveModeFilter });
  const notice = getSingleSearchParam(resolvedSearchParams.notice);
  const error = getSingleSearchParam(resolvedSearchParams.error);
  const query = (getSingleSearchParam(resolvedSearchParams.q) ?? "").trim();
  const stateFilter = getSingleSearchParam(resolvedSearchParams.state) ?? "";

  const filteredCustomers = customers.filter((customer) => {
    const stage = getCustomerStage(customer);
    const searchHaystack = [
      customer.fullName,
      customer.email,
      customer.mollieCustomerId,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    const matchesQuery =
      query.length === 0 || searchHaystack.includes(query.toLowerCase());
    const matchesState = stateFilter.length === 0 || stage === stateFilter;

    return matchesQuery && matchesState;
  });

  const setupCustomers = customers.filter(
    (customer) => getCustomerStage(customer) === "setup",
  ).length;
  const readyCustomers = customers.filter(
    (customer) => getCustomerStage(customer) === "ready",
  ).length;
  const activeSubscriptions = customers.filter(
    (customer) => customer.latestSubscriptionStatus === "active",
  ).length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Customers"
        title="Manage customers and get them subscription-ready"
        description="Create the Mollie customer, track the first payment, verify mandate readiness, and open the focused workspace only when more context is needed."
        actions={
          <DrawerForm
            triggerLabel="New customer"
            title="Create customer"
            description="This creates the local record and the linked Mollie customer so later payment and subscription actions stay attached to the same identity."
          >
            <form action={createCustomerAction} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="fullName">
                  Full name
                </Label>
                <Input
                  id="fullName"
                  name="fullName"
                  required
                  autoComplete="name"
                  className="bg-surface-subtle"
                  placeholder="Customer name"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="email">
                  Email
                </Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  className="bg-surface-subtle"
                  placeholder="customer@example.com"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="notes">
                  Notes
                </Label>
                <Textarea
                  id="notes"
                  name="notes"
                  rows={5}
                  className="bg-surface-subtle"
                  placeholder="Optional internal notes"
                />
              </div>
              <div className="flex justify-end">
                <FormActionButton pendingLabel="Creating customer...">
                  Create customer
                </FormActionButton>
              </div>
            </form>
          </DrawerForm>
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
          { label: "Customers", value: customers.length },
          {
            label: "In setup",
            value: setupCustomers,
            helper: "first payment pending",
            tone: setupCustomers > 0 ? "warning" : "neutral",
          },
          {
            label: "Ready to subscribe",
            value: readyCustomers,
            helper: readyCustomers > 0 ? "mandate ready" : "waiting",
            tone: readyCustomers > 0 ? "accent" : "neutral",
          },
          {
            label: "Active subscriptions",
            value: activeSubscriptions,
            helper: activeSubscriptions > 0 ? "live" : "none",
            tone: activeSubscriptions > 0 ? "accent" : "neutral",
          },
        ]}
      />

      <FilterBar
        resetHref="/customers"
        searchPlaceholder="Search by name, email, or Mollie customer ID"
        searchValue={query}
        filters={[
          {
            label: "State",
            name: "state",
            value: stateFilter,
            options: [
              { label: "All states", value: "" },
              { label: "Setup", value: "setup" },
              { label: "Ready", value: "ready" },
              { label: "Active", value: "active" },
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

      {filteredCustomers.length === 0 ? (
        <EmptyState
          title="No matching customers"
          description="Adjust the filters or create a new customer to start the first-payment and mandate flow."
        />
      ) : (
        <DataTable
          columns={[
            { label: "Customer" },
            { label: "State" },
            { label: "First payment" },
            { label: "Mandate" },
            { label: "Subscription" },
            { label: "Actions", align: "right", className: "w-[210px]" },
          ]}
        >
          {filteredCustomers.map((customer) => {
            const stage = getCustomerStage(customer);
            const firstPaymentStatus =
              customer.latestFirstPaymentStatus ??
              customer.latestFirstPaymentLinkStatus;
            const firstPaymentUrl =
              customer.latestFirstPaymentStatus === "paid"
                ? null
                : customer.latestFirstPaymentLinkUrl ??
                  customer.latestFirstPaymentCheckoutUrl;

            return (
              <tr key={customer.id} className="align-top">
                <td className="px-4 py-4">
                  <div className="min-w-[220px]">
                    <p className="text-sm font-semibold text-ink">
                      {customer.fullName ?? "Unnamed customer"}
                    </p>
                    <p className="mt-1 text-sm text-ink-soft">{customer.email}</p>
                    <p className="mt-2 text-xs text-ink-soft">
                      Created {formatDateTime(customer.createdAt)}
                    </p>
                  </div>
                </td>
                <td className="px-4 py-4">
                  <div className="flex flex-col gap-2">
                    <StatusPill
                      tone={
                        stage === "active"
                          ? "accent"
                          : stage === "ready"
                            ? "warning"
                            : "muted"
                      }
                    >
                      {stage}
                    </StatusPill>
                    <StatusPill
                      tone={customer.mode === "live" ? "warning" : "muted"}
                    >
                      {customer.mode}
                    </StatusPill>
                  </div>
                </td>
                <td className="px-4 py-4">
                  <p className="text-sm font-medium text-ink">
                    {firstPaymentStatus
                      ? formatLabel(firstPaymentStatus)
                      : "Missing"}
                  </p>
                  <p className="mt-1 text-xs text-ink-soft">
                    {formatDateTime(customer.latestFirstPaymentPaidAt)}
                  </p>
                </td>
                <td className="px-4 py-4">
                  <p className="text-sm font-medium text-ink">
                    {customer.hasValidMandate ? "Ready" : "Pending"}
                  </p>
                  <p className="mt-1 text-xs text-ink-soft">
                    {customer.latestMandateStatus
                      ? formatLabel(customer.latestMandateStatus)
                      : "Not synced"}
                  </p>
                </td>
                <td className="px-4 py-4">
                  <p className="text-sm font-medium text-ink">
                    {customer.latestSubscriptionStatus
                      ? formatLabel(customer.latestSubscriptionStatus)
                      : "None"}
                  </p>
                  <p className="mt-1 text-xs text-ink-soft">
                    {customer.subscriptionCount} stored subscription
                    {customer.subscriptionCount === 1 ? "" : "s"}
                  </p>
                </td>
                <td className="px-4 py-4">
                  <div className="flex flex-wrap justify-end gap-2">
                    {firstPaymentUrl ? (
                      <a
                        href={firstPaymentUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex min-h-9 items-center justify-center rounded-lg border border-border-strong px-3 py-1.5 text-sm font-medium text-ink-soft transition-colors hover:bg-surface-muted hover:text-ink"
                      >
                        Payment link
                      </a>
                    ) : null}
                    <Link
                      href={`/customers/${customer.id}`}
                      className="inline-flex min-h-9 items-center justify-center rounded-lg bg-ink px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-ink/88"
                    >
                      Open
                    </Link>
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
