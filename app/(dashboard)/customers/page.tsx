import Link from "next/link";

import { FlashMessage } from "@/components/flash-message";
import { FormActionButton } from "@/components/form-action-button";
import { Panel } from "@/components/panel";
import { StatusPill } from "@/components/status-pill";
import {
  formatDateTime,
  formatLabel,
  getSingleSearchParam,
} from "@/lib/format";
import { createCustomerAction } from "@/lib/onboarding/actions";
import { listCustomers } from "@/lib/onboarding/data";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function CustomersPage({
  searchParams,
}: Readonly<{
  searchParams: SearchParams;
}>) {
  const [customers, resolvedSearchParams] = await Promise.all([
    listCustomers(),
    searchParams,
  ]);
  const notice = getSingleSearchParam(resolvedSearchParams.notice);
  const error = getSingleSearchParam(resolvedSearchParams.error);
  const readyCustomers = customers.filter(
    (customer) =>
      customer.latestFirstPaymentStatus === "paid" && customer.hasValidMandate,
  ).length;
  const activeSubscriptions = customers.filter(
    (customer) => customer.latestSubscriptionStatus === "active",
  ).length;

  return (
    <div className="space-y-6">
      <section className="grid gap-4 xl:grid-cols-[1.35fr_0.95fr]">
        <Panel
          eyebrow="Customers"
          title="Prepare the recurring billing flow one customer at a time"
          description="Each record anchors the safe path: create a Mollie customer, issue the first iDEAL payment, wait for the direct debit mandate, then create the monthly subscription."
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <article className="rounded-[22px] border border-ink/8 bg-white/76 p-4">
              <p className="text-[0.72rem] font-semibold uppercase tracking-[0.2em] text-ink/45">
                Total customers
              </p>
              <p className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-ink">
                {customers.length}
              </p>
            </article>
            <article className="rounded-[22px] border border-ink/8 bg-white/76 p-4">
              <p className="text-[0.72rem] font-semibold uppercase tracking-[0.2em] text-ink/45">
                Ready for subscription
              </p>
              <p className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-ink">
                {readyCustomers}
              </p>
            </article>
            <article className="rounded-[22px] border border-ink/8 bg-white/76 p-4">
              <p className="text-[0.72rem] font-semibold uppercase tracking-[0.2em] text-ink/45">
                Active subscriptions
              </p>
              <p className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-ink">
                {activeSubscriptions}
              </p>
            </article>
          </div>
        </Panel>

        <Panel
          eyebrow="New customer"
          title="Create the Mollie customer record first"
          description="This stores the local record and the Mollie customer ID in one step so later payment and subscription actions stay attached to the same customer."
        >
          <form action={createCustomerAction} className="space-y-4">
            <div className="space-y-2">
              <label
                htmlFor="fullName"
                className="text-sm font-semibold text-ink/82"
              >
                Full name
              </label>
              <input
                id="fullName"
                name="fullName"
                required
                autoComplete="name"
                className="min-h-11 w-full rounded-2xl border border-ink/10 bg-white px-4 text-sm text-ink outline-none transition-colors focus:border-accent"
                placeholder="Customer name"
              />
            </div>
            <div className="space-y-2">
              <label
                htmlFor="email"
                className="text-sm font-semibold text-ink/82"
              >
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                className="min-h-11 w-full rounded-2xl border border-ink/10 bg-white px-4 text-sm text-ink outline-none transition-colors focus:border-accent"
                placeholder="customer@example.com"
              />
            </div>
            <div className="space-y-2">
              <label
                htmlFor="notes"
                className="text-sm font-semibold text-ink/82"
              >
                Notes
              </label>
              <textarea
                id="notes"
                name="notes"
                rows={4}
                className="w-full rounded-[22px] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none transition-colors focus:border-accent"
                placeholder="Optional internal notes"
              />
            </div>
            <FormActionButton pendingLabel="Creating customer...">
              Create customer
            </FormActionButton>
          </form>
        </Panel>
      </section>

      {notice ? (
        <FlashMessage message={notice} title="Update" variant="notice" />
      ) : null}
      {error ? (
        <FlashMessage message={error} title="Action blocked" variant="error" />
      ) : null}

      <Panel
        eyebrow="Workspace"
        title="Customer records and onboarding state"
        description="Each row shows whether the first payment exists, whether a valid mandate is present, and whether a subscription has already been created."
      >
        {customers.length === 0 ? (
          <div className="rounded-[24px] border border-dashed border-ink/12 bg-white/70 px-5 py-8 text-sm leading-6 text-ink/62">
            No customers yet. Create the first one to start the iDEAL and SEPA
            onboarding flow.
          </div>
        ) : (
          <div className="grid gap-3">
            {customers.map((customer) => (
              <article
                key={customer.id}
                className="rounded-[24px] border border-ink/8 bg-white/78 p-4"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-semibold tracking-[-0.03em] text-ink">
                          {customer.fullName ?? "Unnamed customer"}
                        </h3>
                        <StatusPill
                          tone={
                            customer.mode === "live" ? "warning" : "accent"
                          }
                        >
                          {customer.mode}
                        </StatusPill>
                        <StatusPill
                          tone={
                            customer.latestSubscriptionStatus === "active"
                              ? "accent"
                              : customer.hasValidMandate
                                ? "muted"
                                : "warning"
                          }
                        >
                          {customer.latestSubscriptionStatus === "active"
                            ? "subscription active"
                            : customer.hasValidMandate
                              ? "ready to subscribe"
                              : "setup in progress"}
                        </StatusPill>
                      </div>
                      <p className="mt-1 text-sm text-ink/58">{customer.email}</p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <StatusPill
                        tone={
                          customer.latestFirstPaymentStatus === "paid"
                            ? "accent"
                            : customer.latestFirstPaymentStatus
                              ? "warning"
                              : "muted"
                        }
                      >
                        first payment{" "}
                        {customer.latestFirstPaymentStatus
                          ? formatLabel(customer.latestFirstPaymentStatus)
                          : "Missing"}
                      </StatusPill>
                      <StatusPill
                        tone={customer.hasValidMandate ? "accent" : "warning"}
                      >
                        mandate {customer.hasValidMandate ? "Valid" : "Pending"}
                      </StatusPill>
                      <StatusPill
                        tone={
                          customer.subscriptionCount > 0 ? "accent" : "muted"
                        }
                      >
                        {customer.subscriptionCount} subscription
                        {customer.subscriptionCount === 1 ? "" : "s"}
                      </StatusPill>
                    </div>

                    <dl className="grid gap-3 text-sm text-ink/65 sm:grid-cols-3">
                      <div>
                        <dt className="font-semibold text-ink/78">Created</dt>
                        <dd className="mt-1">
                          {formatDateTime(customer.createdAt)}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-ink/78">
                          Latest paid first payment
                        </dt>
                        <dd className="mt-1">
                          {formatDateTime(customer.latestFirstPaymentPaidAt)}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-ink/78">
                          Latest subscription state
                        </dt>
                        <dd className="mt-1">
                          {formatLabel(customer.latestSubscriptionStatus)}
                        </dd>
                      </div>
                    </dl>
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row lg:flex-col">
                    <Link
                      href={`/customers/${customer.id}`}
                      className="inline-flex min-h-11 items-center justify-center rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-ink/88"
                    >
                      Open workspace
                    </Link>
                    {customer.latestFirstPaymentCheckoutUrl ? (
                      <a
                        href={customer.latestFirstPaymentCheckoutUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex min-h-11 items-center justify-center rounded-full border border-ink/10 px-4 py-2 text-sm font-semibold text-ink/76 transition-colors hover:bg-sand/55"
                      >
                        Open checkout
                      </a>
                    ) : null}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
