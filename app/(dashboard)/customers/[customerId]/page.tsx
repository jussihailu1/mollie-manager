import Link from "next/link";
import { notFound } from "next/navigation";

import { DataTable } from "@/components/data-table";
import { DetailSection } from "@/components/detail-section";
import { DrawerForm } from "@/components/drawer-form";
import { EmptyState } from "@/components/empty-state";
import { FlashMessage } from "@/components/flash-message";
import { FormActionButton } from "@/components/form-action-button";
import { InlineNotice } from "@/components/inline-notice";
import { KpiStrip } from "@/components/kpi-strip";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  formatLabel,
  getSingleSearchParam,
} from "@/lib/format";
import {
  createFirstPaymentAction,
  createSubscriptionAction,
  syncCustomerBillingStateAction,
} from "@/lib/onboarding/actions";
import { getCustomerDetail } from "@/lib/onboarding/data";

type CustomerPageProps = {
  params: Promise<{
    customerId: string;
  }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const unsuccessfulFirstPaymentStatuses = new Set(["canceled", "expired", "failed"]);
const terminalFirstPaymentLinkStatuses = new Set([
  "archived",
  "canceled",
  "expired",
  "failed",
  "paid",
]);

function resolveSubscriptionReadiness(
  detail: NonNullable<Awaited<ReturnType<typeof getCustomerDetail>>>,
) {
  const latestFirstPayment = detail.payments.find(
    (payment) => payment.paymentType === "first",
  );
  const latestPaidFirstPayment = detail.payments.find(
    (payment) =>
      payment.paymentType === "first" &&
      payment.mollieStatus === "paid" &&
      payment.paidAt,
  );
  const latestFirstPaymentLink = detail.paymentLinks[0] ?? null;
  const activeFirstPaymentLink = detail.paymentLinks.find(
    (paymentLink) =>
      !terminalFirstPaymentLinkStatuses.has(paymentLink.mollieStatus ?? "open"),
  );
  const firstPaymentShareUrl =
    latestPaidFirstPayment
      ? null
      : activeFirstPaymentLink?.checkoutUrl ??
        (latestFirstPayment &&
        !unsuccessfulFirstPaymentStatuses.has(latestFirstPayment.mollieStatus ?? "")
          ? latestFirstPayment.checkoutUrl
          : null);
  const readyMandate = detail.mandates.find(
    (mandate) =>
      (mandate.method === "directdebit" || mandate.method === "directDebit") &&
      (mandate.mollieStatus === "valid" || mandate.mollieStatus === "pending"),
  );
  const activeSubscription = detail.subscriptions.find(
    (subscription) => subscription.localStatus === "active",
  );

  return {
    activeSubscription,
    activeFirstPaymentLink,
    firstPaymentShareUrl,
    latestFirstPayment,
    latestFirstPaymentLink,
    latestPaidFirstPayment,
    readyMandate,
  };
}

function getWorkspaceNotice(
  detail: NonNullable<Awaited<ReturnType<typeof getCustomerDetail>>>,
) {
  const {
    activeSubscription,
    firstPaymentShareUrl,
    latestFirstPayment,
    latestFirstPaymentLink,
    latestPaidFirstPayment,
    readyMandate,
  } = resolveSubscriptionReadiness(detail);

  if (activeSubscription) {
    return {
      message:
        "Recurring billing is already live for this customer. Use sync to refresh the latest Mollie state or open the subscriptions queue for stop actions.",
      title: "Subscription is active",
      tone: "notice" as const,
    };
  }

  if (!latestFirstPayment && !latestFirstPaymentLink) {
    return {
      message:
        "Start with a customer-linked Mollie Payment Link. The durable link is what you share manually to begin the mandate flow.",
      title: "Create the first payment link",
      tone: "warning" as const,
    };
  }

  if (!latestPaidFirstPayment) {
    if (latestFirstPaymentLink?.mollieStatus === "paid") {
      return {
        message:
          "The first payment link is marked paid. Run sync so the payment and mandate are visible locally before creating the subscription.",
        title: "Sync the paid payment link",
        tone: "warning" as const,
      };
    }

    return {
      message:
        firstPaymentShareUrl
          ? "The first payment link exists but is not paid yet. Share the Payment Link URL, wait for completion, then run a sync before creating the subscription."
          : "The first payment is not paid yet. Create or sync a first-payment link before creating the subscription.",
      title: "Wait for the first payment to complete",
      tone: "warning" as const,
    };
  }

  if (!readyMandate) {
    return {
      message:
        "The first payment is paid, but there is no pending or valid direct debit mandate stored locally yet. Run a sync first.",
      title: "Sync the mandate state",
      tone: "warning" as const,
    };
  }

  return {
    message:
      "The customer has a paid first payment and a recurring mandate. The monthly subscription can be created safely now.",
    title: "Ready to create the subscription",
    tone: "notice" as const,
  };
}

function getStatusTone(value: string | null | undefined) {
  if (!value) {
    return "muted" as const;
  }

  if (["paid", "active", "valid"].includes(value)) {
    return "accent" as const;
  }

  if (
    ["failed", "expired", "canceled", "future_charges_stopped", "out_of_sync"].includes(
      value,
    )
  ) {
    return "warning" as const;
  }

  return "muted" as const;
}

export default async function CustomerDetailPage({
  params,
  searchParams,
}: Readonly<CustomerPageProps>) {
  const [{ customerId }, resolvedSearchParams] = await Promise.all([
    params,
    searchParams,
  ]);
  const detail = await getCustomerDetail(customerId);

  if (!detail) {
    notFound();
  }

  const notice = getSingleSearchParam(resolvedSearchParams.notice);
  const error = getSingleSearchParam(resolvedSearchParams.error);
  const {
    activeSubscription,
    firstPaymentShareUrl,
    latestFirstPayment,
    latestFirstPaymentLink,
    latestPaidFirstPayment,
    readyMandate,
  } = resolveSubscriptionReadiness(detail);
  const workspaceNotice = getWorkspaceNotice(detail);
  const canCreateSubscription = Boolean(
    latestPaidFirstPayment && readyMandate && !activeSubscription,
  );
  const defaultDescription = `${detail.customer.fullName ?? "Customer"} monthly subscription`;
  const firstPaymentStatus =
    latestFirstPayment?.mollieStatus ?? latestFirstPaymentLink?.mollieStatus ?? null;
  const firstPaymentAmount =
    latestFirstPayment ?? latestFirstPaymentLink ?? null;
  const firstPaymentCreatedAt =
    latestFirstPayment?.createdAt ?? latestFirstPaymentLink?.createdAt ?? null;
  const firstPaymentUrl =
    firstPaymentShareUrl ??
    latestFirstPaymentLink?.checkoutUrl ??
    latestFirstPayment?.checkoutUrl ??
    null;
  const hasFirstPaymentStart = Boolean(latestFirstPayment || latestFirstPaymentLink);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Customers"
        title={detail.customer.fullName ?? "Unnamed customer"}
        description={`${detail.customer.email} · Manage the first payment, mandate sync, and monthly subscription from one workspace.`}
        actions={
          <>
            <Link
              href="/customers"
              className="inline-flex min-h-10 items-center justify-center rounded-xl border border-border-strong px-3.5 py-2 text-sm font-medium text-ink-soft transition-colors hover:bg-surface-muted hover:text-ink"
            >
              Back to customers
            </Link>
            <form action={syncCustomerBillingStateAction}>
              <input type="hidden" name="customerId" value={detail.customer.id} />
              <FormActionButton variant="secondary" pendingLabel="Syncing...">
                Sync from Mollie
              </FormActionButton>
            </form>
          </>
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
          {
            label: "Mode",
            value: detail.customer.mode.toUpperCase(),
            helper: detail.customer.mollieCustomerId ?? "local only",
            tone: detail.customer.mode === "live" ? "warning" : "neutral",
          },
          {
            label: "First payment",
            value: firstPaymentStatus ? formatLabel(firstPaymentStatus) : "Missing",
            helper: firstPaymentAmount
              ? formatCurrency(
                  firstPaymentAmount.amountValue,
                  firstPaymentAmount.amountCurrency,
                )
              : "create now",
            tone: latestPaidFirstPayment ? "accent" : "warning",
          },
          {
            label: "Mandate",
            value: readyMandate ? formatLabel(readyMandate.mollieStatus) : "Pending",
            helper: readyMandate?.mollieMandateId ?? "not synced",
            tone: readyMandate ? "accent" : "warning",
          },
          {
            label: "Subscription",
            value: activeSubscription ? formatLabel(activeSubscription.localStatus) : "Not created",
            helper: activeSubscription?.nextPaymentDate
              ? `next ${formatDate(activeSubscription.nextPaymentDate)}`
              : "monthly",
            tone: activeSubscription ? "accent" : "neutral",
          },
        ]}
      />

      <InlineNotice
        tone={workspaceNotice.tone}
        title={workspaceNotice.title}
        message={workspaceNotice.message}
        actions={
          firstPaymentShareUrl ? (
            <a
              href={firstPaymentShareUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-9 items-center justify-center rounded-lg border border-current/15 bg-white/70 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-white"
            >
              Open payment link
            </a>
          ) : null
        }
      />

      <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <DetailSection
          title="Subscription setup"
          description="The workflow stays linear: first payment link, mandate sync, then subscription creation."
        >
          <div className="divide-y divide-border">
            <div className="flex flex-col gap-3 py-3 first:pt-0 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-ink">1. First payment link</p>
                  <StatusPill tone={getStatusTone(firstPaymentStatus)}>
                    {firstPaymentStatus
                      ? formatLabel(firstPaymentStatus)
                      : "Missing"}
                  </StatusPill>
                </div>
                <p className="mt-1 text-sm leading-6 text-ink-soft">
                  Share the durable Mollie Payment Link for the real first
                  installment. The resulting iDEAL payment establishes the
                  mandate.
                </p>
                <p className="mt-2 text-xs text-ink-soft">
                  {firstPaymentCreatedAt
                    ? `Created ${formatDateTime(firstPaymentCreatedAt)}`
                    : "No first payment link has been created yet."}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {firstPaymentShareUrl ? (
                  <a
                    href={firstPaymentShareUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-9 items-center justify-center rounded-lg border border-border-strong px-3 py-1.5 text-sm font-medium text-ink-soft transition-colors hover:bg-surface-muted hover:text-ink"
                  >
                    Payment link
                  </a>
                ) : null}
                <DrawerForm
                  triggerLabel={hasFirstPaymentStart ? "New payment link" : "Create payment link"}
                  triggerVariant={hasFirstPaymentStart ? "secondary" : "primary"}
                  title="Create first payment link"
                  description="This creates a durable customer-linked Mollie Payment Link, restricted to iDEAL, so the customer can complete the first installment and establish the mandate flow."
                >
                  <form action={createFirstPaymentAction} className="space-y-4">
                    <input type="hidden" name="customerId" value={detail.customer.id} />
                    <div className="space-y-2">
                      <label
                        htmlFor="amountValue"
                        className="text-sm font-semibold text-ink"
                      >
                        Amount (EUR)
                      </label>
                      <input
                        id="amountValue"
                        name="amountValue"
                        required
                        inputMode="decimal"
                        defaultValue={latestFirstPayment?.amountValue ?? ""}
                        placeholder="25.00"
                        className="min-h-10 w-full rounded-xl border border-border bg-surface-subtle px-3 text-sm text-ink outline-none transition-colors focus:border-accent"
                      />
                    </div>
                    <div className="space-y-2">
                      <label
                        htmlFor="description"
                        className="text-sm font-semibold text-ink"
                      >
                        Description
                      </label>
                      <input
                        id="description"
                        name="description"
                        required
                        defaultValue={defaultDescription}
                        className="min-h-10 w-full rounded-xl border border-border bg-surface-subtle px-3 text-sm text-ink outline-none transition-colors focus:border-accent"
                      />
                    </div>
                    <div className="flex justify-end">
                      <FormActionButton
                        confirmMessage="Create a durable first-payment link in Mollie for this customer?"
                        pendingLabel="Creating payment link..."
                      >
                        Create payment link
                      </FormActionButton>
                    </div>
                  </form>
                </DrawerForm>
              </div>
            </div>

            <div className="flex flex-col gap-3 py-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-ink">2. Mandate sync</p>
                  <StatusPill tone={readyMandate ? "accent" : "warning"}>
                    {readyMandate ? formatLabel(readyMandate.mollieStatus) : "Pending"}
                  </StatusPill>
                </div>
                <p className="mt-1 text-sm leading-6 text-ink-soft">
                  Refresh Mollie state after the customer pays so the direct
                  debit mandate is stored locally before subscription creation.
                </p>
                <p className="mt-2 text-xs text-ink-soft">
                  {readyMandate
                    ? `Mandate ${readyMandate.mollieMandateId} synced ${formatDateTime(readyMandate.createdAt)}`
                    : "Run sync after the first payment succeeds."}
                </p>
              </div>
              <form action={syncCustomerBillingStateAction}>
                <input type="hidden" name="customerId" value={detail.customer.id} />
                <FormActionButton variant="secondary" pendingLabel="Syncing...">
                  Sync now
                </FormActionButton>
              </form>
            </div>

            <div className="flex flex-col gap-3 py-3 last:pb-0 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-ink">3. Subscription</p>
                  <StatusPill tone={activeSubscription ? "accent" : canCreateSubscription ? "warning" : "muted"}>
                    {activeSubscription
                      ? formatLabel(activeSubscription.localStatus)
                      : canCreateSubscription
                        ? "Ready"
                        : "Blocked"}
                  </StatusPill>
                </div>
                <p className="mt-1 text-sm leading-6 text-ink-soft">
                  Create the monthly subscription only after the paid first
                  payment and mandate are both visible here.
                </p>
                <p className="mt-2 text-xs text-ink-soft">
                  {activeSubscription
                    ? `Starts ${formatDate(activeSubscription.startDate)} and renews every ${activeSubscription.interval}.`
                    : canCreateSubscription
                      ? "The next charge will be scheduled for the same day next month."
                      : "The drawer unlocks when the prerequisite payment and mandate are ready."}
                </p>
              </div>
              <DrawerForm
                triggerLabel="Create subscription"
                disabled={!canCreateSubscription}
                title="Create monthly subscription"
                description="This writes the recurring subscription to Mollie using the verified direct debit mandate and schedules the next charge one month after the paid first installment."
              >
                <form action={createSubscriptionAction} className="space-y-4">
                  <input type="hidden" name="customerId" value={detail.customer.id} />
                  <div className="space-y-2">
                    <label
                      htmlFor="subscriptionAmountValue"
                      className="text-sm font-semibold text-ink"
                    >
                      Amount (EUR)
                    </label>
                    <input
                      id="subscriptionAmountValue"
                      name="amountValue"
                      required
                      inputMode="decimal"
                      defaultValue={
                        activeSubscription?.amountValue ??
                        latestPaidFirstPayment?.amountValue ??
                        ""
                      }
                      placeholder="25.00"
                      className="min-h-10 w-full rounded-xl border border-border bg-surface-subtle px-3 text-sm text-ink outline-none transition-colors focus:border-accent"
                    />
                  </div>
                  <div className="space-y-2">
                    <label
                      htmlFor="subscriptionDescription"
                      className="text-sm font-semibold text-ink"
                    >
                      Description
                    </label>
                    <input
                      id="subscriptionDescription"
                      name="description"
                      required
                      defaultValue={defaultDescription}
                      className="min-h-10 w-full rounded-xl border border-border bg-surface-subtle px-3 text-sm text-ink outline-none transition-colors focus:border-accent"
                    />
                  </div>
                  <div className="flex justify-end">
                    <FormActionButton
                      confirmMessage="Create a monthly direct debit subscription in Mollie for this customer?"
                      pendingLabel="Creating subscription..."
                    >
                      Create subscription
                    </FormActionButton>
                  </div>
                </form>
              </DrawerForm>
            </div>
          </div>
        </DetailSection>

        <DetailSection
          title="Customer record"
          description="Reference data stays visible here without competing with the setup flow."
        >
          <dl className="grid gap-4 text-sm text-ink-soft">
            <div>
              <dt className="font-semibold text-ink">Email</dt>
              <dd className="mt-1">{detail.customer.email}</dd>
            </div>
            <div>
              <dt className="font-semibold text-ink">Local customer ID</dt>
              <dd className="mt-1 break-all font-mono text-[0.82rem]">
                {detail.customer.id}
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-ink">Mollie customer ID</dt>
              <dd className="mt-1 break-all font-mono text-[0.82rem]">
                {detail.customer.mollieCustomerId ?? "Not linked"}
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-ink">Created</dt>
              <dd className="mt-1">{formatDateTime(detail.customer.createdAt)}</dd>
            </div>
            <div>
              <dt className="font-semibold text-ink">Stored subscriptions</dt>
              <dd className="mt-1">{detail.customer.subscriptionCount}</dd>
            </div>
            <div>
              <dt className="font-semibold text-ink">Notes</dt>
              <dd className="mt-1 leading-6">
                {detail.customer.notes ?? "No internal notes stored."}
              </dd>
            </div>
          </dl>
        </DetailSection>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <DetailSection
          title="Current first payment"
          description="Keep the shareable Payment Link URL and the latest payment timestamps close to the workflow."
        >
          {!hasFirstPaymentStart ? (
            <EmptyState
              title="No first payment link yet"
              description="Use the drawer above to create the first-payment link and generate the Mollie Payment Link URL."
            />
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill tone={getStatusTone(firstPaymentStatus)}>
                  {formatLabel(firstPaymentStatus)}
                </StatusPill>
                <StatusPill tone="muted">
                  {latestFirstPayment
                    ? formatLabel(latestFirstPayment.paymentType)
                    : "First payment link"}
                </StatusPill>
                <StatusPill tone="muted">
                  {latestFirstPayment?.method
                    ? formatLabel(latestFirstPayment.method)
                    : "Method pending"}
                </StatusPill>
              </div>
              <dl className="grid gap-4 text-sm text-ink-soft sm:grid-cols-2">
                <div>
                  <dt className="font-semibold text-ink">Amount</dt>
                  <dd className="mt-1">
                    {firstPaymentAmount
                      ? formatCurrency(
                          firstPaymentAmount.amountValue,
                          firstPaymentAmount.amountCurrency,
                        )
                      : "-"}
                  </dd>
                </div>
                <div>
                  <dt className="font-semibold text-ink">Sequence type</dt>
                  <dd className="mt-1">
                    {formatLabel(latestFirstPayment?.sequenceType ?? "first")}
                  </dd>
                </div>
                <div>
                  <dt className="font-semibold text-ink">Created</dt>
                  <dd className="mt-1">{formatDateTime(firstPaymentCreatedAt)}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-ink">Paid</dt>
                  <dd className="mt-1">{formatDateTime(latestFirstPayment?.paidAt)}</dd>
                </div>
              </dl>
              {firstPaymentUrl ? (
                <div className="rounded-[14px] border border-border bg-surface-subtle px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-soft">
                    Payment Link URL
                  </p>
                  <p className="mt-2 break-all font-mono text-[0.82rem] leading-6 text-ink-soft">
                    {firstPaymentUrl}
                  </p>
                </div>
              ) : null}
            </div>
          )}
        </DetailSection>

        <DetailSection
          title="Subscription readiness"
          description="The app blocks recurring setup until Mollie state is complete and visible locally."
        >
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <StatusPill tone={latestPaidFirstPayment ? "accent" : "warning"}>
                {latestPaidFirstPayment ? "Paid first payment" : "First payment missing"}
              </StatusPill>
              <StatusPill tone={readyMandate ? "accent" : "warning"}>
                {readyMandate ? "Mandate ready" : "Mandate missing"}
              </StatusPill>
              <StatusPill tone={activeSubscription ? "accent" : "muted"}>
                {activeSubscription ? "Subscription active" : "No active subscription"}
              </StatusPill>
            </div>
            <dl className="grid gap-4 text-sm text-ink-soft sm:grid-cols-2">
              <div>
                <dt className="font-semibold text-ink">Paid first installment</dt>
                <dd className="mt-1">
                  {latestPaidFirstPayment
                    ? formatDateTime(latestPaidFirstPayment.paidAt)
                    : "Not available"}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-ink">Mandate</dt>
                <dd className="mt-1">
                  {readyMandate
                    ? `${readyMandate.mollieMandateId} (${formatLabel(readyMandate.mollieStatus)})`
                    : "No pending or valid direct debit mandate"}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-ink">Subscription start</dt>
                <dd className="mt-1">
                  {activeSubscription
                    ? formatDate(activeSubscription.startDate)
                    : latestPaidFirstPayment
                      ? "Same day next month after creation"
                      : "Blocked"}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-ink">Next payment</dt>
                <dd className="mt-1">
                  {formatDate(activeSubscription?.nextPaymentDate)}
                </dd>
              </div>
            </dl>
          </div>
        </DetailSection>
      </section>

      <DetailSection
        title="Activity and history"
        description="Secondary detail stays collapsible so the setup path above remains readable."
      >
        <div className="space-y-3">
          <details open className="rounded-[16px] border border-border bg-surface-subtle">
            <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-ink">
              Payments ({detail.payments.length})
            </summary>
            <div className="border-t border-border px-4 py-4">
              {detail.payments.length === 0 ? (
                <EmptyState
                  title="No payments stored"
                  description="Payments created for this customer will show up here after they are written locally."
                />
              ) : (
                <DataTable
                  columns={[
                    { label: "Type" },
                    { label: "Status" },
                    { label: "Amount" },
                    { label: "Created" },
                    { label: "Paid" },
                    { label: "Actions", align: "right", className: "w-[140px]" },
                  ]}
                >
                  {detail.payments.map((payment) => (
                    <tr key={payment.id} className="align-top">
                      <td className="px-4 py-4 text-sm font-medium text-ink">
                        {formatLabel(payment.paymentType)}
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex flex-wrap gap-2">
                          <StatusPill tone={getStatusTone(payment.mollieStatus)}>
                            {formatLabel(payment.mollieStatus)}
                          </StatusPill>
                          <StatusPill tone="muted">
                            {payment.method
                              ? formatLabel(payment.method)
                              : "Method pending"}
                          </StatusPill>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-sm text-ink">
                        {formatCurrency(payment.amountValue, payment.amountCurrency)}
                      </td>
                      <td className="px-4 py-4 text-sm text-ink-soft">
                        {formatDateTime(payment.createdAt)}
                      </td>
                      <td className="px-4 py-4 text-sm text-ink-soft">
                        {formatDateTime(payment.paidAt)}
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex justify-end">
                          {payment.checkoutUrl ? (
                            <a
                              href={payment.checkoutUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex min-h-9 items-center justify-center rounded-lg border border-border-strong px-3 py-1.5 text-sm font-medium text-ink-soft transition-colors hover:bg-surface hover:text-ink"
                            >
                              Checkout
                            </a>
                          ) : (
                            <span className="text-sm text-ink-soft">-</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </DataTable>
              )}
            </div>
          </details>

          <details className="rounded-[16px] border border-border bg-surface-subtle">
            <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-ink">
              Mandates ({detail.mandates.length})
            </summary>
            <div className="border-t border-border px-4 py-4">
              {detail.mandates.length === 0 ? (
                <EmptyState
                  title="No mandates synced"
                  description="Mandates appear here after the first payment succeeds and the customer is synced from Mollie."
                />
              ) : (
                <DataTable
                  columns={[
                    { label: "Mandate" },
                    { label: "Status" },
                    { label: "Method" },
                    { label: "Created" },
                  ]}
                >
                  {detail.mandates.map((mandate) => (
                    <tr key={mandate.id} className="align-top">
                      <td className="px-4 py-4 text-sm font-medium text-ink">
                        {mandate.mollieMandateId}
                      </td>
                      <td className="px-4 py-4">
                        <StatusPill tone={mandate.isValid ? "accent" : "warning"}>
                          {formatLabel(mandate.mollieStatus)}
                        </StatusPill>
                      </td>
                      <td className="px-4 py-4 text-sm text-ink-soft">
                        {formatLabel(mandate.method)}
                      </td>
                      <td className="px-4 py-4 text-sm text-ink-soft">
                        {formatDateTime(mandate.createdAt)}
                      </td>
                    </tr>
                  ))}
                </DataTable>
              )}
            </div>
          </details>

          <details className="rounded-[16px] border border-border bg-surface-subtle">
            <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-ink">
              Subscriptions ({detail.subscriptions.length})
            </summary>
            <div className="border-t border-border px-4 py-4">
              {detail.subscriptions.length === 0 ? (
                <EmptyState
                  title="No subscriptions stored"
                  description="Create the recurring subscription once the first payment is paid and the mandate is ready."
                />
              ) : (
                <DataTable
                  columns={[
                    { label: "Description" },
                    { label: "Status" },
                    { label: "Amount" },
                    { label: "Start date" },
                    { label: "Next payment" },
                  ]}
                >
                  {detail.subscriptions.map((subscription) => (
                    <tr key={subscription.id} className="align-top">
                      <td className="px-4 py-4">
                        <p className="text-sm font-medium text-ink">
                          {subscription.description}
                        </p>
                        <p className="mt-1 text-xs text-ink-soft">
                          {subscription.interval}
                        </p>
                      </td>
                      <td className="px-4 py-4">
                        <StatusPill tone={getStatusTone(subscription.localStatus)}>
                          {formatLabel(subscription.localStatus)}
                        </StatusPill>
                      </td>
                      <td className="px-4 py-4 text-sm text-ink">
                        {formatCurrency(
                          subscription.amountValue,
                          subscription.amountCurrency,
                        )}
                      </td>
                      <td className="px-4 py-4 text-sm text-ink-soft">
                        {formatDate(subscription.startDate)}
                      </td>
                      <td className="px-4 py-4 text-sm text-ink-soft">
                        {formatDate(subscription.nextPaymentDate)}
                      </td>
                    </tr>
                  ))}
                </DataTable>
              )}
            </div>
          </details>
        </div>
      </DetailSection>
    </div>
  );
}
