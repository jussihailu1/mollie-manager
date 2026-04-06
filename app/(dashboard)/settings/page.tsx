import { FlashMessage } from "@/components/flash-message";
import { FormActionButton } from "@/components/form-action-button";
import { Panel } from "@/components/panel";
import { StatusPill } from "@/components/status-pill";
import { requireViewerSession } from "@/lib/auth/session";
import { checkDatabaseConnection } from "@/lib/db";
import { env, getSetupStatus } from "@/lib/env";
import { getSingleSearchParam, formatDateTime } from "@/lib/format";
import { isMollieConfigured } from "@/lib/mollie/client";
import { notificationsAreConfigured } from "@/lib/notifications/email";
import {
  replayWebhookEventAction,
  runReconciliationAction,
} from "@/lib/reliability/actions";
import {
  getReliabilitySnapshot,
  listRecentWebhookEvents,
} from "@/lib/reliability/data";

const sectionLabels = {
  auth: "Google auth",
  database: "Database",
  mollie: "Mollie keys",
  notifications: "Notifications",
  webhook: "Webhook base",
} as const;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function SettingsPage({
  searchParams,
}: Readonly<{
  searchParams: SearchParams;
}>) {
  const session = await requireViewerSession();
  const setupStatus = getSetupStatus();
  const [databaseHealth, reliability, webhookEvents, resolvedSearchParams] =
    await Promise.all([
      checkDatabaseConnection(),
      getReliabilitySnapshot(),
      listRecentWebhookEvents(),
      searchParams,
    ]);
  const notice = getSingleSearchParam(resolvedSearchParams.notice);
  const error = getSingleSearchParam(resolvedSearchParams.error);

  const sections = Object.entries(setupStatus) as Array<
    [keyof typeof setupStatus, (typeof setupStatus)[keyof typeof setupStatus]]
  >;

  return (
    <div className="space-y-6">
      {notice ? (
        <FlashMessage message={notice} title="Update" variant="notice" />
      ) : null}
      {error ? (
        <FlashMessage message={error} title="Action blocked" variant="error" />
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Panel
          eyebrow="Platform"
          title="Configuration and integration readiness"
          description="The environment contract stays explicit so test/live mistakes, missing mail credentials, and incomplete webhook setup are visible before you rely on them."
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
          description="The app remains scoped to a single Google account and one explicit default Mollie mode."
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
            <StatusPill tone={notificationsAreConfigured() ? "accent" : "warning"}>
              smtp {notificationsAreConfigured() ? "ready" : "pending"}
            </StatusPill>
          </div>
        </Panel>
      </section>

      <section className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
        <Panel
          eyebrow="Database"
          title="Operational storage bootstrap"
          description="The dashboard keeps its own operational state, audit trail, alerts, and webhook inbox even though Mollie remains the financial source of truth."
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
            Run the migration command again after pulling changes so newer
            schema files such as the subscription stop-default fix are applied
            in order.
          </p>
        </Panel>

        <Panel
          eyebrow="Webhook"
          title="Mollie callback endpoint"
          description="Mollie does not sign webhooks. This app protects the endpoint by embedding a secret token into the configured webhook URL."
        >
          <div className="rounded-[22px] border border-ink/8 bg-white/76 p-4">
            <p className="text-sm font-semibold text-ink">Public base URL</p>
            <p className="mt-2 break-all font-mono text-[0.8rem] leading-6 text-ink/64">
              {env.MOLLIE_WEBHOOK_PUBLIC_BASE_URL ?? "Not configured"}
            </p>
            <p className="mt-3 text-sm leading-6 text-ink/64">
              New first payments and subscriptions now use a webhook URL with
              the shared secret query parameter appended automatically.
            </p>
          </div>
        </Panel>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <Panel
          eyebrow="Reliability"
          title="Reconciliation and webhook inbox"
          description="This is the phase 5 control surface: durable webhook events, manual replay, and a reconciliation pass that re-syncs all known subscriptions and first payments."
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <article className="rounded-[22px] border border-ink/8 bg-white/76 p-4">
              <p className="text-[0.72rem] font-semibold uppercase tracking-[0.2em] text-ink/45">
                Open alerts
              </p>
              <p className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-ink">
                {reliability.openAlertCount}
              </p>
            </article>
            <article className="rounded-[22px] border border-ink/8 bg-white/76 p-4">
              <p className="text-[0.72rem] font-semibold uppercase tracking-[0.2em] text-ink/45">
                Failed webhook events
              </p>
              <p className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-ink">
                {reliability.failedWebhookCount}
              </p>
            </article>
          </div>

          <dl className="mt-4 grid gap-4 text-sm text-ink/64 sm:grid-cols-2">
            <div>
              <dt className="font-semibold text-ink/82">Last received webhook</dt>
              <dd className="mt-1">
                {formatDateTime(reliability.lastReceivedWebhookAt)}
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-ink/82">Last processed webhook</dt>
              <dd className="mt-1">
                {formatDateTime(reliability.lastProcessedWebhookAt)}
              </dd>
            </div>
          </dl>

          <form action={runReconciliationAction} className="mt-5">
            <input type="hidden" name="returnTo" value="/settings" />
            <FormActionButton
              confirmMessage="Run a full reconciliation pass against Mollie now?"
              pendingLabel="Reconciling..."
            >
              Run reconciliation
            </FormActionButton>
          </form>
        </Panel>

        <Panel
          eyebrow="Mail"
          title="Notification delivery"
          description="Alert emails stay deliberately plain. If SMTP is configured, new durable alerts will trigger a direct email to your inbox."
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
              ALERT_EMAIL_TO.
            </li>
          </ul>
        </Panel>
      </section>

      <Panel
        eyebrow="Inbox"
        title="Recent webhook events"
        description="Failed events can be replayed manually after you fix the underlying issue or after a transient outage."
      >
        {webhookEvents.length === 0 ? (
          <div className="rounded-[24px] border border-dashed border-ink/12 bg-white/70 px-5 py-8 text-sm leading-6 text-ink/62">
            No webhook events have been recorded yet.
          </div>
        ) : (
          <div className="grid gap-3">
            {webhookEvents.map((event) => (
              <article
                key={event.id}
                className="rounded-[24px] border border-ink/8 bg-white/78 p-4"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-ink">
                        {event.resourceId ?? "Unknown resource"}
                      </p>
                      <StatusPill
                        tone={
                          event.processingStatus === "processed"
                            ? "accent"
                            : event.processingStatus === "failed"
                              ? "warning"
                              : "muted"
                        }
                      >
                        {event.processingStatus}
                      </StatusPill>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-ink/62">
                      Received {formatDateTime(event.receivedAt)} · Processed{" "}
                      {formatDateTime(event.processedAt)}
                    </p>
                    {event.errorMessage ? (
                      <p className="mt-2 text-sm leading-6 text-ink/62">
                        {event.errorMessage}
                      </p>
                    ) : null}
                  </div>

                  <form action={replayWebhookEventAction}>
                    <input type="hidden" name="webhookEventId" value={event.id} />
                    <input type="hidden" name="returnTo" value="/settings" />
                    <FormActionButton
                      variant="secondary"
                      pendingLabel="Replaying..."
                    >
                      Replay event
                    </FormActionButton>
                  </form>
                </div>
              </article>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
