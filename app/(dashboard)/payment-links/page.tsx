import Link from "next/link";

import { DetailSection } from "@/components/detail-section";
import { EmptyState } from "@/components/empty-state";
import { KpiStrip } from "@/components/kpi-strip";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";

export default function PaymentLinksPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Payment links"
        title="Standalone payment-link management"
        description="This module stays separate from the recurring onboarding flow. It is reserved for one-off payment-link objects, not subscription setup."
        actions={
          <Link
            href="/customers"
            className="inline-flex min-h-10 items-center justify-center rounded-xl border border-border-strong px-3.5 py-2 text-sm font-medium text-ink-soft transition-colors hover:bg-surface-muted hover:text-ink"
          >
            Back to customers
          </Link>
        }
      />

      <KpiStrip
        items={[
          { label: "Stored links", value: 0, helper: "not wired", tone: "neutral" },
          { label: "Active links", value: 0, helper: "planned", tone: "neutral" },
          { label: "Expired links", value: 0, helper: "planned", tone: "neutral" },
          { label: "Module state", value: "Scaffold", helper: "next phase", tone: "warning" },
        ]}
      />

      <section className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <DetailSection
          title="Why this page exists"
          description="Payment links are still useful, but they solve a different problem than customer-linked first payments for subscriptions."
        >
          <div className="space-y-3 text-sm leading-6 text-ink-soft">
            <p>
              Subscription onboarding should continue to use the customer first
              payment flow so the recurring mandate setup stays correct.
            </p>
            <p>
              This page will later manage real Mollie payment-link objects for
              one-off collections, manual recovery, or ad hoc invoices.
            </p>
            <p>
              Keeping the flows separate reduces the chance of using the wrong
              object type when you are working quickly.
            </p>
          </div>
        </DetailSection>

        <DetailSection
          title="Planned scope"
          description="The UI shell is in place so the future module can land without changing the rest of the app architecture."
        >
          <div className="flex flex-wrap gap-2">
            <StatusPill tone="warning">Create links</StatusPill>
            <StatusPill tone="muted">Track expiry</StatusPill>
            <StatusPill tone="muted">Open link</StatusPill>
            <StatusPill tone="muted">Link history</StatusPill>
          </div>
        </DetailSection>
      </section>

      <EmptyState
        title="Standalone payment links are not wired yet"
        description="The subscription workflow can create customer-linked first-payment links. This page is reserved for separate one-off payment-link support in a later pass."
        action={
          <Link
            href="/customers"
            className="inline-flex min-h-10 items-center justify-center rounded-xl bg-ink px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-ink/88"
          >
            Return to customer setup
          </Link>
        }
      />
    </div>
  );
}
