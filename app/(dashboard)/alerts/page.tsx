import Link from "next/link";

import { Panel } from "@/components/panel";
import { StatusPill } from "@/components/status-pill";
import { formatDateTime } from "@/lib/format";
import { listAlertInbox } from "@/lib/reliability/data";

export default async function AlertsPage() {
  const alerts = await listAlertInbox();

  return (
    <div className="space-y-6">
      <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Panel
          eyebrow="Alerts"
          title="Operational attention queue"
          description="Phase 4 surfaces a derived queue from failed payments and problematic subscription states. Phase 5 will add durable alert records and email delivery."
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <article className="rounded-[22px] border border-ink/8 bg-white/76 p-4">
              <p className="text-[0.72rem] font-semibold uppercase tracking-[0.2em] text-ink/45">
                Open operational items
              </p>
              <p className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-ink">
                {alerts.filter((alert) => alert.status === "open").length}
              </p>
            </article>
            <article className="rounded-[22px] border border-ink/8 bg-white/76 p-4">
              <p className="text-[0.72rem] font-semibold uppercase tracking-[0.2em] text-ink/45">
                Email delivery
              </p>
              <p className="mt-3 text-base font-semibold text-ink">
                Active
              </p>
            </article>
          </div>
        </Panel>

        <Panel
          eyebrow="Scope"
          title="What appears here now"
          description="This page now reads from durable alert records. Each alert can survive webhook retries, reconciliation passes, and future email delivery retries."
        >
          <div className="flex flex-wrap gap-2">
            <StatusPill tone="warning">failed payments</StatusPill>
            <StatusPill tone="warning">expired payments</StatusPill>
            <StatusPill tone="warning">payment action required</StatusPill>
            <StatusPill tone="warning">webhook durable</StatusPill>
          </div>
        </Panel>
      </section>

      <Panel
        eyebrow="Queue"
        title="Current attention items"
        description="Use the linked payment or subscription workspace to investigate and sync the underlying state."
      >
        {alerts.length === 0 ? (
          <div className="rounded-[24px] border border-dashed border-ink/12 bg-white/70 px-5 py-8 text-sm leading-6 text-ink/62">
            No current operational attention items are derived from the local
            store.
          </div>
        ) : (
          <div className="grid gap-3">
            {alerts.map((alert) => (
              <article
                key={alert.id}
                className="rounded-[24px] border border-ink/8 bg-white/78 p-4"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-semibold tracking-[-0.03em] text-ink">
                        {alert.title}
                      </h3>
                      <StatusPill
                        tone={alert.severity === "critical" ? "warning" : "muted"}
                      >
                        {alert.severity}
                      </StatusPill>
                      <StatusPill
                        tone={alert.status === "open" ? "warning" : "muted"}
                      >
                        {alert.status}
                      </StatusPill>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-ink/62">
                      {alert.message}
                    </p>
                    <p className="mt-3 text-sm text-ink/62">
                      {alert.customerName ?? "Unknown customer"}
                      {alert.customerEmail ? ` · ${alert.customerEmail}` : ""}
                    </p>
                    <p className="mt-1 text-sm text-ink/55">
                      Detected {formatDateTime(alert.createdAt)}
                    </p>
                    <p className="mt-1 text-sm text-ink/55">
                      Email sent{" "}
                      {alert.emailSentAt ? formatDateTime(alert.emailSentAt) : "not yet"}
                    </p>
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row lg:flex-col">
                    {alert.subscriptionId ? (
                      <Link
                        href={`/subscriptions?focus=${alert.subscriptionId}`}
                        className="inline-flex min-h-11 items-center justify-center rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-ink/88"
                      >
                        Open subscription
                      </Link>
                    ) : null}
                    {alert.paymentId ? (
                      <Link
                        href={`/payments?focus=${alert.paymentId}`}
                        className="inline-flex min-h-11 items-center justify-center rounded-full border border-ink/10 px-4 py-2 text-sm font-semibold text-ink/78 transition-colors hover:bg-sand/55"
                      >
                        Open payment
                      </Link>
                    ) : null}
                    {alert.customerId ? (
                      <Link
                        href={`/customers/${alert.customerId}`}
                        className="inline-flex min-h-11 items-center justify-center rounded-full border border-ink/10 px-4 py-2 text-sm font-semibold text-ink/78 transition-colors hover:bg-sand/55"
                      >
                        Open customer
                      </Link>
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
