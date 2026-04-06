import Link from "next/link";

import { FlashMessage } from "@/components/flash-message";
import { Panel } from "@/components/panel";
import { StatusPill } from "@/components/status-pill";
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
  const [payments, resolvedSearchParams] = await Promise.all([
    listPayments(),
    searchParams,
  ]);
  const notice = getSingleSearchParam(resolvedSearchParams.notice);
  const error = getSingleSearchParam(resolvedSearchParams.error);
  const focusId = getSingleSearchParam(resolvedSearchParams.focus);
  const paidCount = payments.filter((payment) => payment.mollieStatus === "paid").length;
  const failedCount = payments.filter((payment) =>
    ["failed", "expired"].includes(payment.mollieStatus ?? ""),
  ).length;
  const recurringCount = payments.filter(
    (payment) => payment.paymentType === "recurring",
  ).length;

  return (
    <div className="space-y-6">
      <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Panel
          eyebrow="Payments"
          title="Operational payment history from the local store"
          description="This page shows the payment records the app has actually stored. First payments arrive during onboarding, and recurring payments appear after a subscription sync."
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <article className="rounded-[22px] border border-ink/8 bg-white/76 p-4">
              <p className="text-[0.72rem] font-semibold uppercase tracking-[0.2em] text-ink/45">
                Total stored
              </p>
              <p className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-ink">
                {payments.length}
              </p>
            </article>
            <article className="rounded-[22px] border border-ink/8 bg-white/76 p-4">
              <p className="text-[0.72rem] font-semibold uppercase tracking-[0.2em] text-ink/45">
                Paid
              </p>
              <p className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-ink">
                {paidCount}
              </p>
            </article>
            <article className="rounded-[22px] border border-ink/8 bg-white/76 p-4">
              <p className="text-[0.72rem] font-semibold uppercase tracking-[0.2em] text-ink/45">
                Recurring stored
              </p>
              <p className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-ink">
                {recurringCount}
              </p>
            </article>
          </div>
        </Panel>

        <Panel
          eyebrow="Collection"
          title="Manual sync still matters"
          description="Until the webhook layer is in place, recurring payments only appear here after you sync a subscription from the subscriptions workspace."
        >
          <Link
            href="/subscriptions"
            className="inline-flex min-h-11 items-center justify-center rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-ink/88"
          >
            Open subscriptions
          </Link>
          <p className="mt-4 text-sm leading-6 text-ink/62">
            Payments with status {`failed`} or {`expired`} are treated as attention
            items and also appear in the Alerts page.
          </p>
        </Panel>
      </section>

      {notice ? (
        <FlashMessage message={notice} title="Update" variant="notice" />
      ) : null}
      {error ? (
        <FlashMessage message={error} title="Action blocked" variant="error" />
      ) : null}

      <Panel
        eyebrow="History"
        title="Stored payment records"
        description="The source of financial truth remains Mollie. This view shows the local operational cache the app uses for tracking, navigation, and later alerting."
      >
        {payments.length === 0 ? (
          <div className="rounded-[24px] border border-dashed border-ink/12 bg-white/70 px-5 py-8 text-sm leading-6 text-ink/62">
            No payment records are stored yet.
          </div>
        ) : (
          <div className="grid gap-3">
            {payments.map((payment) => {
              const isFocused = focusId === payment.id;
              const tone =
                payment.mollieStatus === "paid"
                  ? "accent"
                  : payment.mollieStatus === "failed" ||
                      payment.mollieStatus === "expired"
                    ? "warning"
                    : "muted";

              return (
                <article
                  key={payment.id}
                  className={`rounded-[24px] border bg-white/78 p-4 ${
                    isFocused
                      ? "border-accent/35 shadow-[0_22px_60px_rgba(15,118,110,0.16)]"
                      : "border-ink/8"
                  }`}
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-lg font-semibold tracking-[-0.03em] text-ink">
                          {formatCurrency(payment.amountValue, payment.amountCurrency)}
                        </p>
                        <StatusPill tone={tone}>
                          {formatLabel(payment.mollieStatus)}
                        </StatusPill>
                        <StatusPill tone="muted">
                          {formatLabel(payment.paymentType)}
                        </StatusPill>
                        <StatusPill
                          tone={payment.mode === "live" ? "warning" : "accent"}
                        >
                          {payment.mode}
                        </StatusPill>
                      </div>

                      <p className="mt-2 text-sm leading-6 text-ink/62">
                        {payment.customerName ?? "Unknown customer"}
                        {payment.customerEmail ? ` · ${payment.customerEmail}` : ""}
                      </p>

                      <dl className="mt-4 grid gap-3 text-sm text-ink/66 sm:grid-cols-4">
                        <div>
                          <dt className="font-semibold text-ink/82">Created</dt>
                          <dd className="mt-1">
                            {formatDateTime(payment.createdAt)}
                          </dd>
                        </div>
                        <div>
                          <dt className="font-semibold text-ink/82">Paid</dt>
                          <dd className="mt-1">{formatDateTime(payment.paidAt)}</dd>
                        </div>
                        <div>
                          <dt className="font-semibold text-ink/82">Failed</dt>
                          <dd className="mt-1">{formatDateTime(payment.failedAt)}</dd>
                        </div>
                        <div>
                          <dt className="font-semibold text-ink/82">Method</dt>
                          <dd className="mt-1">{formatLabel(payment.method)}</dd>
                        </div>
                      </dl>

                      {payment.subscriptionDescription ? (
                        <p className="mt-3 text-sm text-ink/62">
                          Subscription: {payment.subscriptionDescription}
                        </p>
                      ) : null}
                    </div>

                    <div className="flex flex-col gap-2 sm:flex-row lg:flex-col">
                      {payment.customerId ? (
                        <Link
                          href={`/customers/${payment.customerId}`}
                          className="inline-flex min-h-11 items-center justify-center rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-ink/88"
                        >
                          Open customer
                        </Link>
                      ) : null}
                      {payment.subscriptionId ? (
                        <Link
                          href={`/subscriptions?focus=${payment.subscriptionId}`}
                          className="inline-flex min-h-11 items-center justify-center rounded-full border border-ink/10 px-4 py-2 text-sm font-semibold text-ink/78 transition-colors hover:bg-sand/55"
                        >
                          Open subscription
                        </Link>
                      ) : null}
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
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {failedCount > 0 ? (
          <p className="mt-5 text-sm leading-6 text-ink/62">
            {failedCount} payment{failedCount === 1 ? "" : "s"} currently need
            attention.
          </p>
        ) : null}
      </Panel>
    </div>
  );
}
