import Link from "next/link";

import { Panel } from "@/components/panel";
import { StatusPill } from "@/components/status-pill";
import {
  moduleRegistry,
  type DashboardModuleId,
} from "@/lib/mollie-manager";

export function ModulePlaceholder({
  moduleId,
}: Readonly<{
  moduleId: DashboardModuleId;
}>) {
  const moduleConfig = moduleRegistry[moduleId];

  return (
    <div className="space-y-6">
      <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <Panel
          eyebrow={moduleConfig.eyebrow}
          title={moduleConfig.title}
          description={moduleConfig.description}
        >
          <div className="flex flex-wrap gap-2">
            {moduleConfig.states.map((state) => (
              <StatusPill key={state} tone="muted">
                {state}
              </StatusPill>
            ))}
          </div>
          <p className="mt-4 text-sm leading-6 text-ink/62">
            This section is scaffolded in phase 1 so the later implementation
            can attach real actions and real Mollie data without changing the
            information architecture.
          </p>
        </Panel>

        <Panel
          eyebrow="Phase target"
          title={moduleConfig.phaseTitle}
          description={moduleConfig.phaseDescription}
        >
          <div className="rounded-[20px] border border-accent/15 bg-accent-soft px-4 py-3 text-sm leading-6 text-accent-strong">
            {moduleConfig.phaseCallout}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <StatusPill tone="warning">Later phase</StatusPill>
            <StatusPill tone="muted">No live writes yet</StatusPill>
          </div>
        </Panel>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <Panel
          eyebrow="Capabilities"
          title="What belongs here"
          description="The module contract is set now, even before the data and actions are wired."
        >
          <ul className="space-y-3">
            {moduleConfig.capabilities.map((capability) => (
              <li
                key={capability}
                className="border-b border-ink/6 pb-3 text-sm leading-6 text-ink/68 last:border-b-0 last:pb-0"
              >
                {capability}
              </li>
            ))}
          </ul>
        </Panel>

        <Panel
          eyebrow="Risks"
          title="Operational notes"
          description="These notes will shape the implementation for the module when we wire it up."
        >
          <ul className="space-y-3">
            {moduleConfig.notes.map((note) => (
              <li
                key={note}
                className="rounded-[18px] border border-ink/8 bg-sand/55 px-4 py-3 text-sm leading-6 text-ink/68"
              >
                {note}
              </li>
            ))}
          </ul>
        </Panel>
      </section>

      <section className="flex flex-wrap items-center gap-3 rounded-[24px] border border-ink/8 bg-white/75 px-5 py-4">
        <span className="text-sm font-semibold text-ink">Next likely step:</span>
        <span className="text-sm text-ink/62">{moduleConfig.nextStep}</span>
        <Link
          href="/"
          className="ml-auto rounded-full border border-ink/10 px-4 py-2 text-sm font-medium text-ink/72 transition-colors hover:bg-ink hover:text-white"
        >
          Back to overview
        </Link>
      </section>
    </div>
  );
}

