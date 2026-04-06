import Link from "next/link";
import { notFound } from "next/navigation";

import { FlashMessage } from "@/components/flash-message";
import { FormActionButton } from "@/components/form-action-button";
import { Panel } from "@/components/panel";
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

function resolveSubscriptionReadiness(
  detail: NonNullable<Awaited<ReturnType<typeof getCustomerDetail>>>,
) {
  const latestPaidFirstPayment = detail.payments.find(
    (payment) =>
      payment.paymentType === "first" &&
      payment.mollieStatus === "paid" &&
      payment.paidAt,
  );
  const validMandate =
    detail.mandates.find(
      (mandate) =>
        mandate.isValid &&
        (mandate.method === "directdebit" || mandate.method === "directDebit"),
    ) ?? detail.mandates.find((mandate) => mandate.isValid);

  return {
    latestPaidFirstPayment,
    validMandate,
  };
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
  const latestFirstPayment = detail.payments.find(
    (payment) => payment.paymentType === "first",
  );
  const { latestPaidFirstPayment, validMandate } =
    resolveSubscriptionReadiness(detail);
  const activeSubscription = detail.subscriptions.find(
    (subscription) => subscription.localStatus === "active",
  );
  const canCreateSubscription = Boolean(latestPaidFirstPayment && validMandate);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Link
            href="/customers"
            className="text-sm font-medium text-ink/55 transition-colors hover:text-ink"
          >
            Customers
          </Link>
          <h1 className="mt-2 text-3xl font-semibold tracking-[-0.05em] text-ink">
            {detail.customer.fullName ?? "Unnamed customer"}
          </h1>
          <p className="mt-2 text-sm leading-6 text-ink/62">
            {detail.customer.email} · Mollie customer{" "}
            {detail.customer.mollieCustomerId ?? "not linked"}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <StatusPill
            tone={detail.customer.mode === "live" ? "warning" : "accent"}
          >
            {detail.customer.mode}
          </StatusPill>
          <StatusPill tone={latestPaidFirstPayment ? "accent" : "warning"}>
            {latestPaidFirstPayment ? "first payment paid" : "first payment pending"}
          </StatusPill>
          <StatusPill tone={validMandate ? "accent" : "warning"}>
            {validMandate ? "mandate valid" : "mandate pending"}
          </StatusPill>
          <StatusPill tone={activeSubscription ? "accent" : "muted"}>
            {activeSubscription ? "subscription active" : "subscription not created"}
          </StatusPill>
        </div>
      </div>

      {notice ? (
        <FlashMessage message={notice} title="Update" variant="notice" />
      ) : null}
      {error ? (
        <FlashMessage message={error} title="Action blocked" variant="error" />
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <Panel
          eyebrow="State"
          title="Onboarding status"
          description="The app keeps the next safe action visible instead of exposing every billing action at once."
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <article className="rounded-[22px] border border-ink/8 bg-white/78 p-4">
              <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-ink/45">
                1. First payment
              </p>
              <p className="mt-3 text-sm font-semibold text-ink">
                {latestFirstPayment
                  ? formatLabel(latestFirstPayment.mollieStatus)
                  : "Not created"}
              </p>
              <p className="mt-2 text-sm leading-6 text-ink/62">
                {latestFirstPayment
                  ? `Latest update: ${formatDateTime(latestFirstPayment.paidAt ?? latestFirstPayment.failedAt ?? latestFirstPayment.createdAt)}`
                  : "Create the first iDEAL checkout URL to start the mandate flow."}
              </p>
            </article>
            <article className="rounded-[22px] border border-ink/8 bg-white/78 p-4">
              <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-ink/45">
                2. Mandate
              </p>
              <p className="mt-3 text-sm font-semibold text-ink">
                {validMandate
                  ? `${formatLabel(validMandate.mollieStatus)} (${validMandate.mollieMandateId})`
                  : "Pending sync"}
              </p>
              <p className="mt-2 text-sm leading-6 text-ink/62">
                {validMandate
                  ? "A valid direct debit mandate is available for future recurring collections."
                  : "After the customer pays, run a sync so the mandate state is refreshed from Mollie."}
              </p>
            </article>
            <article className="rounded-[22px] border border-ink/8 bg-white/78 p-4">
              <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-ink/45">
                3. Subscription
              </p>
              <p className="mt-3 text-sm font-semibold text-ink">
                {activeSubscription
                  ? formatLabel(activeSubscription.localStatus)
                  : "Not created"}
              </p>
              <p className="mt-2 text-sm leading-6 text-ink/62">
                {activeSubscription
                  ? `Billing starts on ${formatDate(activeSubscription.startDate)} and renews monthly.`
                  : "The subscription form unlocks once the first payment is paid and a valid mandate exists."}
              </p>
            </article>
          </div>
        </Panel>

        <Panel
          eyebrow="Record"
          title="Customer reference"
          description="This panel keeps the identifiers and notes that anchor the later Mollie resources."
        >
          <dl className="grid gap-4 text-sm text-ink/68">
            <div>
              <dt className="font-semibold text-ink/82">Created</dt>
              <dd className="mt-1">{formatDateTime(detail.customer.createdAt)}</dd>
            </div>
            <div>
              <dt className="font-semibold text-ink/82">Local customer ID</dt>
              <dd className="mt-1 break-all font-mono text-[0.82rem]">
                {detail.customer.id}
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-ink/82">Mollie customer ID</dt>
              <dd className="mt-1 break-all font-mono text-[0.82rem]">
                {detail.customer.mollieCustomerId ?? "Not available"}
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-ink/82">Notes</dt>
              <dd className="mt-1 leading-6">
                {detail.customer.notes ?? "No internal notes yet."}
              </dd>
            </div>
          </dl>
        </Panel>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <Panel
          eyebrow="Step 1"
          title="Create the first iDEAL payment"
          description="This charges the real first installment, returns a checkout URL you can share manually, and establishes the recurring mandate path."
        >
          <form action={createFirstPaymentAction} className="space-y-4">
            <input type="hidden" name="customerId" value={detail.customer.id} />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label
                  htmlFor="amountValue"
                  className="text-sm font-semibold text-ink/82"
                >
                  Amount (EUR)
                </label>
                <input
                  id="amountValue"
                  name="amountValue"
                  required
                  inputMode="decimal"
                  placeholder="25.00"
                  className="min-h-11 w-full rounded-2xl border border-ink/10 bg-white px-4 text-sm text-ink outline-none transition-colors focus:border-accent"
                />
              </div>
              <div className="space-y-2">
                <label
                  htmlFor="description"
                  className="text-sm font-semibold text-ink/82"
                >
                  Description
                </label>
                <input
                  id="description"
                  name="description"
                  required
                  defaultValue={`${detail.customer.fullName ?? "Customer"} monthly subscription`}
                  className="min-h-11 w-full rounded-2xl border border-ink/10 bg-white px-4 text-sm text-ink outline-none transition-colors focus:border-accent"
                />
              </div>
            </div>

            {latestFirstPayment?.checkoutUrl ? (
              <div className="rounded-[20px] border border-ink/8 bg-sand/55 p-4">
                <p className="text-sm font-semibold text-ink">Latest checkout URL</p>
                <p className="mt-2 break-all font-mono text-[0.8rem] leading-6 text-ink/62">
                  {latestFirstPayment.checkoutUrl}
                </p>
                <div className="mt-3">
                  <a
                    href={latestFirstPayment.checkoutUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-11 items-center justify-center rounded-full border border-ink/10 px-4 py-2 text-sm font-semibold text-ink/78 transition-colors hover:bg-white"
                  >
                    Open Mollie checkout
                  </a>
                </div>
              </div>
            ) : null}

            <FormActionButton
              confirmMessage="Create a real first payment in Mollie for this customer?"
              pendingLabel="Creating payment..."
            >
              Create first payment
            </FormActionButton>
          </form>
        </Panel>

        <Panel
          eyebrow="Step 2"
          title="Refresh mandate and payment state"
          description="Use this after the customer returns from Mollie or after you know they have paid. It syncs the local record from Mollie before a subscription can be created."
        >
          <div className="rounded-[22px] border border-ink/8 bg-white/76 p-4">
            <dl className="grid gap-4 text-sm text-ink/66 sm:grid-cols-2">
              <div>
                <dt className="font-semibold text-ink/82">Latest payment status</dt>
                <dd className="mt-1">
                  {formatLabel(latestFirstPayment?.mollieStatus)}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-ink/82">Valid mandate</dt>
                <dd className="mt-1">{validMandate ? "Yes" : "No"}</dd>
              </div>
            </dl>
          </div>

          <form action={syncCustomerBillingStateAction} className="mt-4">
            <input type="hidden" name="customerId" value={detail.customer.id} />
            <FormActionButton variant="secondary" pendingLabel="Refreshing...">
              Sync from Mollie
            </FormActionButton>
          </form>
        </Panel>
      </section>

      <Panel
        eyebrow="Step 3"
        title="Create the monthly subscription"
        description="This remains blocked until the first payment is paid and a valid mandate exists. The first recurring charge is scheduled for the same day next month."
      >
        <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
          <div className="rounded-[22px] border border-ink/8 bg-white/76 p-4">
            <p className="text-sm font-semibold text-ink">Readiness checks</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <StatusPill tone={latestPaidFirstPayment ? "accent" : "warning"}>
                {latestPaidFirstPayment ? "paid first payment" : "first payment missing"}
              </StatusPill>
              <StatusPill tone={validMandate ? "accent" : "warning"}>
                {validMandate ? "valid mandate" : "mandate missing"}
              </StatusPill>
              <StatusPill tone={activeSubscription ? "accent" : "muted"}>
                {activeSubscription ? "subscription already exists" : "no active subscription"}
              </StatusPill>
            </div>
            <p className="mt-4 text-sm leading-6 text-ink/62">
              {canCreateSubscription
                ? "The prerequisites are present. Creating the subscription will schedule the next charge in Mollie."
                : "Use the first-payment and sync steps first. The form stays disabled until the customer is actually ready."}
            </p>
          </div>

          <form action={createSubscriptionAction} className="space-y-4">
            <input type="hidden" name="customerId" value={detail.customer.id} />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label
                  htmlFor="subscriptionAmountValue"
                  className="text-sm font-semibold text-ink/82"
                >
                  Amount (EUR)
                </label>
                <input
                  id="subscriptionAmountValue"
                  name="amountValue"
                  required
                  disabled={!canCreateSubscription}
                  inputMode="decimal"
                  placeholder="25.00"
                  className="min-h-11 w-full rounded-2xl border border-ink/10 bg-white px-4 text-sm text-ink outline-none transition-colors focus:border-accent disabled:bg-sand/40 disabled:text-ink/45"
                />
              </div>
              <div className="space-y-2">
                <label
                  htmlFor="subscriptionDescription"
                  className="text-sm font-semibold text-ink/82"
                >
                  Description
                </label>
                <input
                  id="subscriptionDescription"
                  name="description"
                  required
                  disabled={!canCreateSubscription}
                  defaultValue={`${detail.customer.fullName ?? "Customer"} monthly subscription`}
                  className="min-h-11 w-full rounded-2xl border border-ink/10 bg-white px-4 text-sm text-ink outline-none transition-colors focus:border-accent disabled:bg-sand/40 disabled:text-ink/45"
                />
              </div>
            </div>

            <FormActionButton
              confirmMessage="Create a monthly direct debit subscription in Mollie for this customer?"
              disabled={!canCreateSubscription}
              pendingLabel="Creating subscription..."
            >
              Create subscription
            </FormActionButton>
          </form>
        </div>
      </Panel>

      <section className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <Panel
          eyebrow="History"
          title="Payments and mandates"
          description="The local history makes it obvious what was created, what succeeded, and what still needs a sync."
        >
          <div className="space-y-3">
            {detail.payments.length === 0 ? (
              <div className="rounded-[22px] border border-dashed border-ink/12 bg-white/70 px-4 py-6 text-sm text-ink/62">
                No payments have been created for this customer yet.
              </div>
            ) : (
              detail.payments.map((payment) => (
                <article
                  key={payment.id}
                  className="rounded-[22px] border border-ink/8 bg-white/78 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-ink">
                          {formatCurrency(payment.amountValue, payment.amountCurrency)}
                        </p>
                        <StatusPill
                          tone={
                            payment.mollieStatus === "paid"
                              ? "accent"
                              : payment.mollieStatus
                                ? "warning"
                                : "muted"
                          }
                        >
                          {formatLabel(payment.mollieStatus)}
                        </StatusPill>
                        <StatusPill tone="muted">
                          {formatLabel(payment.paymentType)}
                        </StatusPill>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-ink/62">
                        Created {formatDateTime(payment.createdAt)} · Paid{" "}
                        {formatDateTime(payment.paidAt)}
                      </p>
                    </div>
                    {payment.checkoutUrl ? (
                      <a
                        href={payment.checkoutUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex min-h-11 items-center justify-center rounded-full border border-ink/10 px-4 py-2 text-sm font-semibold text-ink/78 transition-colors hover:bg-sand/55"
                      >
                        Open checkout
                      </a>
                    ) : null}
                  </div>
                </article>
              ))
            )}
          </div>

          <div className="mt-5 space-y-3">
            {detail.mandates.length === 0 ? (
              <div className="rounded-[22px] border border-dashed border-ink/12 bg-white/70 px-4 py-6 text-sm text-ink/62">
                No mandates synced yet.
              </div>
            ) : (
              detail.mandates.map((mandate) => (
                <article
                  key={mandate.id}
                  className="rounded-[22px] border border-ink/8 bg-sand/55 p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-ink">
                      {mandate.mollieMandateId}
                    </p>
                    <StatusPill tone={mandate.isValid ? "accent" : "warning"}>
                      {mandate.isValid ? "valid" : "not valid"}
                    </StatusPill>
                    <StatusPill tone="muted">
                      {formatLabel(mandate.method)}
                    </StatusPill>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-ink/62">
                    Created {formatDateTime(mandate.createdAt)} · Status{" "}
                    {formatLabel(mandate.mollieStatus)}
                  </p>
                </article>
              ))
            )}
          </div>
        </Panel>

        <Panel
          eyebrow="History"
          title="Subscriptions"
          description="Recurring subscriptions are listed separately so you can see what has already been scheduled for this customer."
        >
          <div className="space-y-3">
            {detail.subscriptions.length === 0 ? (
              <div className="rounded-[22px] border border-dashed border-ink/12 bg-white/70 px-4 py-6 text-sm text-ink/62">
                No subscriptions created yet for this customer.
              </div>
            ) : (
              detail.subscriptions.map((subscription) => (
                <article
                  key={subscription.id}
                  className="rounded-[22px] border border-ink/8 bg-white/78 p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-ink">
                      {subscription.description}
                    </p>
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
                  </div>
                  <p className="mt-2 text-sm leading-6 text-ink/62">
                    {formatCurrency(
                      subscription.amountValue,
                      subscription.amountCurrency,
                    )}{" "}
                    every {subscription.interval} · Starts{" "}
                    {formatDate(subscription.startDate)}
                  </p>
                </article>
              ))
            )}
          </div>
        </Panel>
      </section>
    </div>
  );
}
