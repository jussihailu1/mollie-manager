import Link from "next/link";

import { Panel } from "@/components/panel";
import { StatusPill } from "@/components/status-pill";
import {
  dashboardNavigation,
  derivedSubscriptionStates,
  foundationPhases,
  foundationRails,
  onboardingFlow,
} from "@/lib/mollie-manager";

export default function OverviewPage() {
  return (
    <div className="space-y-6">
      <section className="grid gap-4 xl:grid-cols-[1.4fr_0.9fr]">
        <Panel
          eyebrow="Overview"
          title="A controlled workspace for recurring revenue operations"
          description="This foundation anchors the app around the operational flow that matters most: first authorization, mandate creation, then safe recurring collections."
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {onboardingFlow.map((step, index) => (
              <article
                key={step.title}
                className="rounded-[22px] border border-ink/8 bg-white/72 p-4"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-ink/80">
                    {index + 1}. {step.title}
                  </span>
                  <StatusPill tone={step.tone}>{step.label}</StatusPill>
                </div>
                <p className="mt-3 text-sm leading-6 text-ink/62">
                  {step.description}
                </p>
              </article>
            ))}
          </div>
        </Panel>

        <Panel
          eyebrow="Release plan"
          title="Implementation phases"
          description="Each phase adds one operational layer without hiding risk behind mock behavior."
        >
          <ol className="space-y-3">
            {foundationPhases.map((phase) => (
              <li
                key={phase.title}
                className="rounded-[20px] border border-ink/8 bg-sand/65 px-4 py-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-ink">
                      {phase.title}
                    </h3>
                    <p className="mt-1 text-sm text-ink/62">
                      {phase.description}
                    </p>
                  </div>
                  <StatusPill tone={phase.tone}>{phase.state}</StatusPill>
                </div>
              </li>
            ))}
          </ol>
        </Panel>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr_0.9fr]">
        <Panel
          eyebrow="Safety"
          title="Guardrails that belong in the app, not in memory"
          description="Mollie remains the financial source of truth. The app adds operational control around it."
        >
          <ul className="space-y-3">
            {foundationRails.map((rail) => (
              <li
                key={rail.title}
                className="flex items-start gap-3 border-b border-ink/6 pb-3 last:border-b-0 last:pb-0"
              >
                <div className="mt-1 h-2.5 w-2.5 rounded-full bg-accent" />
                <div>
                  <p className="text-sm font-semibold text-ink">{rail.title}</p>
                  <p className="mt-1 text-sm leading-6 text-ink/62">
                    {rail.description}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel
          eyebrow="Domain model"
          title="Derived subscription states"
          description="These are app-level states that will sit on top of Mollie objects in later phases."
        >
          <div className="flex flex-wrap gap-2">
            {derivedSubscriptionStates.map((state) => (
              <StatusPill key={state} tone="muted">
                {state}
              </StatusPill>
            ))}
          </div>
          <p className="mt-4 text-sm leading-6 text-ink/62">
            They let the dashboard distinguish between raw Mollie resource
            status and operational states like pending first payment or a sync
            mismatch that needs review.
          </p>
        </Panel>

        <Panel
          eyebrow="Diagnostics"
          title="Foundation endpoints"
          description="A lightweight health route is already present so we have a stable place to expand operational checks."
        >
          <div className="rounded-[22px] border border-ink/8 bg-ink px-4 py-3 font-mono text-sm text-white">
            GET /api/health
          </div>
          <p className="mt-4 text-sm leading-6 text-ink/62">
            Later this will report database connectivity, auth readiness,
            webhook freshness, and last reconciliation timing.
          </p>
        </Panel>
      </section>

      <section className="rounded-[28px] border border-ink/8 bg-sand/55 p-4 sm:p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[0.72rem] font-semibold uppercase tracking-[0.28em] text-ink/45">
              Modules
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-ink">
              Workspace sections prepared for later phases
            </h2>
          </div>
          <p className="max-w-xl text-sm leading-6 text-ink/62">
            The shell is in place so each module can gain real data and actions
            without reworking navigation or the operating model.
          </p>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {dashboardNavigation
            .filter((item) => item.href !== "/")
            .map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="group rounded-[22px] border border-ink/8 bg-white/82 p-4 transition-transform duration-200 hover:-translate-y-0.5"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-ink">
                    {item.label}
                  </span>
                  <StatusPill tone="muted">Prepared</StatusPill>
                </div>
                <p className="mt-3 text-sm leading-6 text-ink/62">
                  {item.description}
                </p>
              </Link>
            ))}
        </div>
      </section>
    </div>
  );
}
