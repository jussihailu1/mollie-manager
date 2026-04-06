import { Panel } from "@/components/panel";
import { StatusPill } from "@/components/status-pill";
import { requireViewerSession } from "@/lib/auth/session";
import { checkDatabaseConnection } from "@/lib/db";
import { env, getSetupStatus } from "@/lib/env";
import { isMollieConfigured } from "@/lib/mollie/client";

const sectionLabels = {
  auth: "Google auth",
  database: "Database",
  mollie: "Mollie keys",
  notifications: "Notifications",
  webhook: "Webhook base",
} as const;

export default async function SettingsPage() {
  const session = await requireViewerSession();
  const setupStatus = getSetupStatus();
  const databaseHealth = await checkDatabaseConnection();

  const sections = Object.entries(setupStatus) as Array<
    [keyof typeof setupStatus, (typeof setupStatus)[keyof typeof setupStatus]]
  >;

  return (
    <div className="space-y-6">
      <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Panel
          eyebrow="Platform"
          title="Configuration and integration readiness"
          description="This phase establishes the boundaries the billing workflow will rely on: owner authentication, PostgreSQL connectivity, and safe Mollie mode separation."
        >
          <div className="grid gap-3 md:grid-cols-2">
            {sections.map(([key, status]) => (
              <article
                key={key}
                className="rounded-[22px] border border-ink/8 bg-white/76 p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-ink">
                    {sectionLabels[key]}
                  </h3>
                  <StatusPill tone={status.ready ? "accent" : "warning"}>
                    {status.ready ? "Ready" : "Needs setup"}
                  </StatusPill>
                </div>
                {status.issues.length > 0 ? (
                  <ul className="mt-4 space-y-2 text-sm leading-6 text-ink/64">
                    {status.issues.map((issue) => (
                      <li key={issue}>{issue}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-4 text-sm leading-6 text-ink/64">
                    This section has the required environment inputs.
                  </p>
                )}
              </article>
            ))}
          </div>
        </Panel>

        <Panel
          eyebrow="Owner session"
          title="Current operator context"
          description="The app is currently scoped to a single Google account."
        >
          <div className="rounded-[22px] border border-ink/8 bg-sand/55 p-4">
            <p className="text-sm font-semibold text-ink">Signed in as</p>
            <p className="mt-2 text-sm leading-6 text-ink/64">{session.user.email}</p>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <StatusPill tone={env.MOLLIE_DEFAULT_MODE === "live" ? "warning" : "accent"}>
              default mode: {env.MOLLIE_DEFAULT_MODE}
            </StatusPill>
            <StatusPill tone={isMollieConfigured("test") ? "accent" : "warning"}>
              test key {isMollieConfigured("test") ? "ready" : "missing"}
            </StatusPill>
            <StatusPill tone={isMollieConfigured("live") ? "accent" : "warning"}>
              live key {isMollieConfigured("live") ? "ready" : "missing"}
            </StatusPill>
          </div>
        </Panel>
      </section>

      <section className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
        <Panel
          eyebrow="Database"
          title="Operational storage bootstrap"
          description="The dashboard will keep its own operational data even while Mollie remains the payment source of truth."
        >
          <div className="rounded-[22px] border border-ink/8 bg-white/76 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-semibold text-ink">Connection check</p>
              <StatusPill tone={databaseHealth.ok ? "accent" : "warning"}>
                {databaseHealth.ok ? "Connected" : "Not connected"}
              </StatusPill>
            </div>
            <p className="mt-3 text-sm leading-6 text-ink/64">{databaseHealth.reason}</p>
          </div>
          <div className="mt-4 rounded-[22px] border border-ink/8 bg-sand/55 p-4 font-mono text-sm text-ink/78">
            npm.cmd run db:apply
          </div>
          <p className="mt-4 text-sm leading-6 text-ink/64">
            The initial schema lives in
            <span className="font-mono text-[0.8rem]"> db/migrations/0001_initial.sql</span>
            and creates the customer, mandate, subscription, payment, alert,
            audit, and webhook tables the next phases will use.
          </p>
        </Panel>

        <Panel
          eyebrow="Auth and mail"
          title="Environment contract"
          description="These values are intentionally explicit so test/live mistakes are harder to make under pressure."
        >
          <ul className="space-y-3 text-sm leading-6 text-ink/64">
            <li>
              <span className="font-semibold text-ink">Google auth:</span> AUTH_GOOGLE_ID,
              AUTH_GOOGLE_SECRET, AUTH_ALLOWED_EMAIL, AUTH_SECRET.
            </li>
            <li>
              <span className="font-semibold text-ink">Database:</span> DATABASE_URL and
              optional DATABASE_SSL.
            </li>
            <li>
              <span className="font-semibold text-ink">Mollie:</span> separate test/live API
              keys plus a single explicit default mode.
            </li>
            <li>
              <span className="font-semibold text-ink">Notifications:</span> SMTP_* and
              ALERT_EMAIL_TO remain plain and swappable for a future provider.
            </li>
          </ul>
        </Panel>
      </section>
    </div>
  );
}
