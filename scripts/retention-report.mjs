#!/usr/bin/env node

import nextEnv from "@next/env";
import pg from "pg";

const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());

function parseMode(value) {
  if (value === "live" || value === "test") {
    return value;
  }

  return null;
}

function parseDays(value, fallback, label) {
  const parsed = Number.parseInt(value ?? `${fallback}`, 10);

  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }

  return parsed;
}

const mode = parseMode(process.argv[2] ?? process.env.RETENTION_MODE ?? "all");
const auditDays = parseDays(process.argv[3] ?? process.env.RETENTION_AUDIT_DAYS, 365, "auditDays");
const webhookDays = parseDays(
  process.argv[4] ?? process.env.RETENTION_WEBHOOK_DAYS,
  180,
  "webhookDays",
);
const consentDays = parseDays(
  process.argv[5] ?? process.env.RETENTION_CONSENT_DAYS,
  365,
  "consentDays",
);
const connectionString = process.env.DATABASE_URL;
const useSsl = process.env.DATABASE_SSL === "true";

if (!connectionString) {
  throw new Error("DATABASE_URL is required for the retention report.");
}

const { Pool } = pg;
const pool = new Pool({
  connectionString,
  ssl: useSsl ? true : undefined,
});

try {
  const [auditLogsRows, webhookEventsRows, consentRows] = await Promise.all([
    pool.query(
      `
        select
          count(*)::int as total_count,
          count(*) filter (where created_at < now() - $1::int * interval '1 day')::int as older_than_days_count,
          count(*) filter (where outcome = 'failure')::int as failure_count,
          count(*) filter (where mode is null)::int as global_count,
          min(created_at) as oldest_created_at,
          max(created_at) as newest_created_at
        from audit_logs
        where ($2::mollie_mode is null or mode = $2 or mode is null)
      `,
      [auditDays, mode],
    ),
    pool.query(
      `
        select
          count(*)::int as total_count,
          count(*) filter (where received_at < now() - $1::int * interval '1 day')::int as older_than_days_count,
          count(*) filter (where processing_status = 'pending')::int as pending_count,
          count(*) filter (where processing_status = 'processed')::int as processed_count,
          count(*) filter (where processing_status = 'failed')::int as failed_count,
          max(retry_count)::int as max_retry_count,
          min(received_at) as oldest_received_at,
          max(received_at) as newest_received_at
        from webhook_events
        where ($2::mollie_mode is null or mode = $2)
      `,
      [webhookDays, mode],
    ),
    pool.query(
      `
        select
          count(*)::int as total_count,
          count(*) filter (where consent_token is not null)::int as legacy_plaintext_token_count,
          count(*) filter (where consent_token_hash is not null)::int as hashed_token_count,
          count(*) filter (where consent_token_ciphertext is not null)::int as encrypted_token_count,
          count(*) filter (where accepted_at is not null)::int as accepted_count,
          count(*) filter (
            where accepted_at < now() - $1::int * interval '1 day'
          )::int as accepted_older_than_days_count,
          count(*) filter (where accepted_ip is not null)::int as accepted_ip_count,
          count(*) filter (where accepted_user_agent is not null)::int as accepted_user_agent_count,
          min(created_at) as oldest_created_at,
          min(accepted_at) as oldest_accepted_at,
          max(accepted_at) as newest_accepted_at
        from subscription_onboarding_consents
        where ($2::mollie_mode is null or mode = $2)
      `,
      [consentDays, mode],
    ),
  ]);

  const auditLogs = auditLogsRows.rows[0] ?? null;
  const webhookEvents = webhookEventsRows.rows[0] ?? null;
  const consents = consentRows.rows[0] ?? null;

  const report = {
    generatedAt: new Date().toISOString(),
    mode: mode ?? "all",
    thresholdsDays: {
      audit: auditDays,
      consent: consentDays,
      webhook: webhookDays,
    },
    findings: {
      auditLogs,
      consentEvidence: consents,
      webhookEvents,
    },
    recommendations: [
      consents && Number(consents.legacy_plaintext_token_count) > 0
        ? "Run the consent-token backfill before any purge work."
        : "No legacy plaintext consent tokens found.",
      auditLogs && Number(auditLogs.older_than_days_count) > 0
        ? "Audit log retention windows still need a policy decision before any destructive cleanup."
        : "No audit log rows currently exceed the report threshold.",
      webhookEvents && Number(webhookEvents.older_than_days_count) > 0
        ? "Webhook event retention windows still need a policy decision before any destructive cleanup."
        : "No webhook event rows currently exceed the report threshold.",
    ],
  };

  console.log(JSON.stringify(report, null, 2));
} finally {
  await pool.end();
}
