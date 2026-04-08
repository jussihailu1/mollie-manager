import { DataTable } from "@/components/data-table";
import { DashboardModeToggle } from "@/components/dashboard-mode-controls";
import { DetailSection } from "@/components/detail-section";
import { EmptyState } from "@/components/empty-state";
import { FlashMessage } from "@/components/flash-message";
import { FormActionButton } from "@/components/form-action-button";
import { KpiStrip } from "@/components/kpi-strip";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import {
  getSelectedMollieMode,
  resolveDashboardModeFilter,
} from "@/lib/dashboard-mode";
import { checkDatabaseConnection } from "@/lib/db";
import { env, getSetupStatus } from "@/lib/env";
import { formatDateTime, getSingleSearchParam } from "@/lib/format";
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

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const sectionLabels = {
  auth: "Authentication",
  database: "Database",
  mollie: "Mollie keys",
  notifications: "Notifications",
  webhook: "Webhook base URL",
} as const;

function getModeTone(mode: "all" | "live" | "test") {
  if (mode === "all") {
    return "muted";
  }

  return mode === "live" ? "warning" : "accent";
}

function buildSettingsReturnTo(modeFilter: string) {
  return modeFilter ? `/settings?mode=${modeFilter}` : "/settings";
}

export default async function SettingsPage({
  searchParams,
}: Readonly<{
  searchParams: SearchParams;
}>) {
  const resolvedSearchParams = await searchParams;
  const selectedMode = await getSelectedMollieMode();
  const rawModeFilter = getSingleSearchParam(resolvedSearchParams.mode);
  const effectiveModeFilter = await resolveDashboardModeFilter(rawModeFilter);
  const modeFilter =
    rawModeFilter === "all" || rawModeFilter === "test" || rawModeFilter === "live"
      ? rawModeFilter
      : "";
  const settingsReturnTo = buildSettingsReturnTo(modeFilter);
  const setupStatus = getSetupStatus();
  const [databaseHealth, reliability, webhookEvents] = await Promise.all([
    checkDatabaseConnection(),
    getReliabilitySnapshot({ mode: effectiveModeFilter }),
    listRecentWebhookEvents({ mode: effectiveModeFilter }),
  ]);
  const notice = getSingleSearchParam(resolvedSearchParams.notice);
  const error = getSingleSearchParam(resolvedSearchParams.error);

  const sections = Object.entries(setupStatus) as Array<
    [keyof typeof setupStatus, (typeof setupStatus)[keyof typeof setupStatus]]
  >;
  const readySectionCount = sections.filter(([, status]) => status.ready).length;
  const platformHealthItems = [
    {
      description: env.AUTH_ALLOWED_EMAIL
        ? `Owner access is limited to ${env.AUTH_ALLOWED_EMAIL}.`
        : "Google allowlist is not configured yet.",
      label: sectionLabels.auth,
      ready: setupStatus.auth.ready,
    },
    {
      description: databaseHealth.reason,
      label: sectionLabels.database,
      ready: databaseHealth.ok,
    },
    {
      description: env.MOLLIE_WEBHOOK_PUBLIC_BASE_URL ?? "Not configured",
      label: sectionLabels.webhook,
      ready: setupStatus.webhook.ready,
    },
  ];
  const integrationItems = [
    {
      description: isMollieConfigured("test")
        ? "Test credentials are available."
        : "Test API key is missing.",
      label: "Mollie test",
      ready: isMollieConfigured("test"),
    },
    {
      description: isMollieConfigured("live")
        ? "Live credentials are available."
        : "Live API key is missing.",
      label: "Mollie live",
      ready: isMollieConfigured("live"),
    },
    {
      description: notificationsAreConfigured()
        ? `Email route from ${env.SMTP_FROM} to ${env.ALERT_EMAIL_TO}.`
        : "SMTP configuration is incomplete.",
      label: "Notifications",
      ready: notificationsAreConfigured(),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Settings"
        title="Mode, integrations, and reliability controls"
        description="Keep the operator context calm: pick the default working mode, confirm the platform is wired correctly, and run reliability tools when the queue needs it."
        actions={
          <StatusPill tone={getModeTone(effectiveModeFilter)}>
            {effectiveModeFilter === "all"
              ? "Viewing all modes"
              : `Viewing ${effectiveModeFilter} mode`}
          </StatusPill>
        }
      />

      {notice ? (
        <FlashMessage message={notice} title="Update" variant="notice" />
      ) : null}
      {error ? (
        <FlashMessage message={error} title="Action blocked" variant="error" />
      ) : null}

      <KpiStrip
        items={[
          {
            label: "Platform ready",
            value: `${readySectionCount}/${sections.length}`,
            helper: readySectionCount === sections.length ? "healthy" : "review",
            tone: readySectionCount === sections.length ? "accent" : "warning",
          },
          {
            label: "Open alerts",
            value: reliability.openAlertCount,
            helper: reliability.openAlertCount > 0 ? "queue active" : "clear",
            tone: reliability.openAlertCount > 0 ? "warning" : "accent",
          },
          {
            label: "Failed webhooks",
            value: reliability.failedWebhookCount,
            helper: reliability.failedWebhookCount > 0 ? "replay needed" : "healthy",
            tone: reliability.failedWebhookCount > 0 ? "warning" : "neutral",
          },
          {
            label: "Unresolved alerts",
            value: reliability.unresolvedAlertCount,
            helper:
              effectiveModeFilter === "all" ? "all modes" : `${effectiveModeFilter} scope`,
            tone: effectiveModeFilter === "all" ? "neutral" : "accent",
          },
        ]}
      />

      <section className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <DetailSection
          title="Default operating mode"
          description="This controls the mode for new customer creation and the default dashboard scope. Existing records keep their own stored mode."
          actions={<DashboardModeToggle selectedMode={selectedMode} />}
        >
          <div className="flex flex-col gap-3 text-sm text-ink-soft">
            <p>
              New customers are created in <span className="font-medium text-ink">{selectedMode}</span> mode.
            </p>
            <p>
              Most dashboard pages default to that mode unless you explicitly override them with a
              mode filter.
            </p>
            {effectiveModeFilter !== selectedMode ? (
              <div className="flex flex-wrap gap-2">
                <StatusPill tone={getModeTone(selectedMode)}>
                  Default {selectedMode}
                </StatusPill>
                <StatusPill tone={getModeTone(effectiveModeFilter)}>
                  Viewing {effectiveModeFilter}
                </StatusPill>
              </div>
            ) : null}
          </div>
        </DetailSection>

        <DetailSection
          title="Platform health"
          description="These checks stay visible here instead of living in the shell."
        >
          <div className="flex flex-col divide-y divide-border/80">
            {platformHealthItems.map((item) => (
              <div
                key={item.label}
                className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 lg:flex-row lg:items-start lg:justify-between"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">{item.label}</p>
                  <p className="text-sm leading-6 text-ink-soft">{item.description}</p>
                </div>
                <StatusPill tone={item.ready ? "accent" : "warning"}>
                  {item.ready ? "Ready" : "Needs setup"}
                </StatusPill>
              </div>
            ))}
          </div>
        </DetailSection>
      </section>

      <section className="grid gap-4 xl:grid-cols-[0.96fr_1.04fr]">
        <DetailSection
          title="Integrations"
          description="Compact service status for the boundaries this app depends on."
        >
          <div className="flex flex-col divide-y divide-border/80">
            {integrationItems.map((item) => (
              <div
                key={item.label}
                className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 lg:flex-row lg:items-start lg:justify-between"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">{item.label}</p>
                  <p className="text-sm leading-6 text-ink-soft">{item.description}</p>
                </div>
                <StatusPill tone={item.ready ? "accent" : "warning"}>
                  {item.ready ? "Ready" : "Missing"}
                </StatusPill>
              </div>
            ))}
          </div>
        </DetailSection>

        <DetailSection
          title="Reliability tools"
          description="Run deliberate maintenance actions without turning settings into a setup console."
        >
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 rounded-xl border border-border/80 bg-surface-subtle p-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">Run reconciliation</p>
                <p className="text-sm leading-6 text-ink-soft">
                  Re-fetch known subscriptions and first payments from Mollie when data needs a hard refresh.
                </p>
              </div>
              <form action={runReconciliationAction}>
                <input type="hidden" name="returnTo" value={settingsReturnTo} />
                <FormActionButton
                  confirmMessage="Run a full reconciliation pass against Mollie now?"
                  pendingLabel="Reconciling..."
                >
                  Run reconciliation
                </FormActionButton>
              </form>
            </div>

            <div className="flex flex-col gap-2 rounded-xl border border-border/80 bg-surface-subtle p-4 text-sm text-ink-soft">
              <p className="font-medium text-ink">Replay failed webhooks from the event table below.</p>
              <p>
                Each replay re-fetches current Mollie state rather than trusting the stored webhook payload.
              </p>
            </div>
          </div>
        </DetailSection>
      </section>

      <DetailSection
        title="Recent webhook events"
        description="Use replay after a transient outage or after you have fixed the underlying issue."
      >
        {webhookEvents.length === 0 ? (
          <EmptyState
            title="No webhook events recorded"
            description="Incoming Mollie callbacks will appear here after the first payment or subscription flow runs."
          />
        ) : (
          <DataTable
            columns={[
              { label: "Resource" },
              { label: "Status" },
              { label: "Mode" },
              { label: "Received" },
              { label: "Processed" },
              { label: "Retries" },
              { label: "Actions", align: "right", className: "w-[130px]" },
            ]}
          >
            {webhookEvents.map((event) => (
              <tr key={event.id}>
                <td>
                  <div className="flex min-w-[260px] flex-col gap-1">
                    <p className="text-sm font-medium text-ink">
                      {event.resourceId ?? "Unknown resource"}
                    </p>
                    <p className="text-sm text-ink-soft">
                      {event.resourceType ?? "Unknown type"}
                    </p>
                    {event.errorMessage ? (
                      <p className="text-sm leading-6 text-ink-soft">{event.errorMessage}</p>
                    ) : null}
                  </div>
                </td>
                <td>
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
                </td>
                <td>
                  <StatusPill tone={event.mode === "live" ? "warning" : "accent"}>
                    {event.mode}
                  </StatusPill>
                </td>
                <td className="font-mono text-xs text-ink-soft">
                  {formatDateTime(event.receivedAt)}
                </td>
                <td className="font-mono text-xs text-ink-soft">
                  {formatDateTime(event.processedAt)}
                </td>
                <td className="text-sm text-ink">{event.retryCount}</td>
                <td>
                  <div className="flex justify-end">
                    <form action={replayWebhookEventAction}>
                      <input type="hidden" name="webhookEventId" value={event.id} />
                      <input type="hidden" name="returnTo" value={settingsReturnTo} />
                      <FormActionButton variant="secondary" pendingLabel="Replaying...">
                        Replay
                      </FormActionButton>
                    </form>
                  </div>
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </DetailSection>
    </div>
  );
}
