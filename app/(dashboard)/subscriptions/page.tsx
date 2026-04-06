import Link from "next/link";

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
  const [subscriptions, resolvedSearchParams] = await Promise.all([
    listSubscriptions(),
    searchParams,
  ]);
  const notice = getSingleSearchParam(resolvedSearchParams.notice);
  const error = getSingleSearchParam(resolvedSearchParams.error);
  const focusId = getSingleSearchParam(resolvedSearchParams.focus);
  const activeCount = subscriptions.filter(
    (subscription) => subscription.localStatus === "active",
  ).length;
  const stopQueuedCount = subscriptions.filter(
    (subscription) => subscription.stopAfterCurrentPeriod,
  ).length;

  return (
    <div className="space-y-6">
      <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Panel
          eyebrow="Subscriptions"
          title="Recurring billing control with guarded stop behavior"
          description="Phase 4 adds operational controls around the subscriptions created in phase 3: manual sync, visible payment history, and a protected stop-future-charges action."
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <article className="rounded-[22px] border border-ink/8 bg-white/76 p-4">
              <p className="text-[0.72rem] font-semibold uppercase tracking-[0.2em] text-ink/45">
                Total
              </p>
              <p className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-ink">
                {subscriptions.length}
              </p>
            </article>
            <article className="rounded-[22px] border border-ink/8 bg-white/76 p-4">
              <p className="text-[0.72rem] font-semibold uppercase tracking-[0.2em] text-ink/45">
                Active
              </p>
              <p className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-ink">
                {activeCount}
              </p>
            </article>
            <article className="rounded-[22px] border border-ink/8 bg-white/76 p-4">
              <p className="text-[0.72rem] font-semibold uppercase tracking-[0.2em] text-ink/45">
                Future charges stopped
              </p>
              <p className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-ink">
                {stopQueuedCount}
              </p>
            </article>
          </div>
        </Panel>

        <Panel
          eyebrow="Creation"
          title="Create subscriptions from customers"
          description="Creation still happens inside the customer workspace so the first payment, mandate, and subscription stay in the same operating context."
        >
          <Link
            href="/customers"
            className="inline-flex min-h-11 items-center justify-center rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-ink/88"
          >
            Open customers
          </Link>
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
        title="Current recurring subscriptions"
        description="Sync before trusting the local state, and require an explicit confirmation before stopping future charges."
      >
        {subscriptions.length === 0 ? (
          <div className="rounded-[24px] border border-dashed border-ink/12 bg-white/70 px-5 py-8 text-sm leading-6 text-ink/62">
            No subscriptions yet. Create the first one from a customer record
            after the first payment has been paid and synced.
          </div>
        ) : (
          <div className="grid gap-3">
            {subscriptions.map((subscription) => {
              const canStopFutureCharges =
                subscription.localStatus !== "future_charges_stopped";
              const isFocused = focusId === subscription.id;

              return (
                <article
                  key={subscription.id}
                  className={`rounded-[24px] border bg-white/78 p-4 ${
                    isFocused
                      ? "border-accent/35 shadow-[0_22px_60px_rgba(15,118,110,0.16)]"
                      : "border-ink/8"
                  }`}
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-semibold tracking-[-0.03em] text-ink">
                          {subscription.description}
                        </h3>
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
                        <StatusPill
                          tone={subscription.mode === "live" ? "warning" : "accent"}
                        >
                          {subscription.mode}
                        </StatusPill>
                        <StatusPill tone="muted">
                          Mollie {formatLabel(subscription.mollieStatus)}
                        </StatusPill>
                      </div>

                      <p className="mt-2 text-sm leading-6 text-ink/62">
                        {formatCurrency(
                          subscription.amountValue,
                          subscription.amountCurrency,
                        )}{" "}
                        every {subscription.interval}
                      </p>

                      <dl className="mt-4 grid gap-3 text-sm text-ink/66 sm:grid-cols-4">
                        <div>
                          <dt className="font-semibold text-ink/82">Customer</dt>
                          <dd className="mt-1">
                            {subscription.customerName ?? "Unnamed customer"}
                            <span className="block text-ink/55">
                              {subscription.customerEmail}
                            </span>
                          </dd>
                        </div>
                        <div>
                          <dt className="font-semibold text-ink/82">Start date</dt>
                          <dd className="mt-1">{formatDate(subscription.startDate)}</dd>
                        </div>
                        <div>
                          <dt className="font-semibold text-ink/82">
                            Next payment
                          </dt>
                          <dd className="mt-1">
                            {formatDate(subscription.nextPaymentDate)}
                          </dd>
                        </div>
                        <div>
                          <dt className="font-semibold text-ink/82">Created</dt>
                          <dd className="mt-1">
                            {formatDateTime(subscription.createdAt)}
                          </dd>
                        </div>
                      </dl>

                      {subscription.canceledAt ? (
                        <p className="mt-3 text-sm text-ink/62">
                          Future charges were stopped on{" "}
                          {formatDateTime(subscription.canceledAt)}.
                        </p>
                      ) : null}
                    </div>

                    <div className="flex flex-col gap-2 sm:flex-row lg:flex-col">
                      <Link
                        href={`/customers/${subscription.customerId}`}
                        className="inline-flex min-h-11 items-center justify-center rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-ink/88"
                      >
                        Open customer
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
                        <FormActionButton
                          variant="secondary"
                          pendingLabel="Syncing..."
                        >
                          Sync from Mollie
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
                        >
                          Stop future charges
                        </FormActionButton>
                      </form>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}
