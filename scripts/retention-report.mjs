#!/usr/bin/env node

import nextEnv from "@next/env";
import pg from "pg";

import retentionPolicy from "../lib/retention-policy.ts";

const {
  parseRetentionMode,
  RETENTION_POLICY,
  RETENTION_POLICY_VERSION,
  RETENTION_WINDOWS,
} = retentionPolicy;

const { loadEnvConfig } = nextEnv;
const { Pool } = pg;

loadEnvConfig(process.cwd());

const REPORT_KINDS = new Set(["inventory", "candidates"]);
const STATEMENT_TIMEOUT = "5s";
const ACCEPTED_WINDOWS = {
  auditDetailsDays: 180,
  consentClientDataMonths: 12,
  processedWebhookPayloadDays: 180,
};

function parseReportKind(value) {
  if (!REPORT_KINDS.has(value)) {
    throw new Error("report kind must be one of: inventory, candidates.");
  }

  return value;
}

function parseExplicitMode(value, reportKind) {
  if (value === undefined || value === "") {
    throw new Error("mode is required: live, test, or all for inventory.");
  }

  const mode = parseRetentionMode(value);
  if (reportKind === "candidates" && mode === "all") {
    throw new Error("candidate reporting requires an explicit live or test mode.");
  }

  return mode;
}

const reportKind = parseReportKind(process.argv[2]);
const mode = parseExplicitMode(process.argv[3], reportKind);

if (
  RETENTION_WINDOWS.auditDetails !== ACCEPTED_WINDOWS.auditDetailsDays ||
  RETENTION_WINDOWS.acceptedConsentClientDataMonths !==
    ACCEPTED_WINDOWS.consentClientDataMonths ||
  RETENTION_WINDOWS.processedWebhookPayload !==
    ACCEPTED_WINDOWS.processedWebhookPayloadDays
) {
  throw new Error("retention policy windows are not approved for this report.");
}

const connectionString = process.env.DATABASE_URL;
const useSsl = process.env.DATABASE_SSL === "true";

if (!connectionString) {
  throw new Error("DATABASE_URL is required for the retention report.");
}

const pool = new Pool({
  connectionString,
  ssl: useSsl ? true : undefined,
});
const client = await pool.connect();

try {
  await client.query("BEGIN READ ONLY");
  await client.query(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT}'`);

  if (reportKind === "inventory") {
    const [auditResult, consentResult, webhookResult] = await Promise.all([
      client.query(
        `
          select count(*)::int as count
          from audit_logs
          where ($1::mollie_mode is null or mode = $1 or mode is null)
        `,
        [mode === "all" ? null : mode],
      ),
      client.query(
        `
          select count(*)::int as count
          from subscription_onboarding_consents
          where ($1::mollie_mode is null or mode = $1)
        `,
        [mode === "all" ? null : mode],
      ),
      client.query(
        `
          select count(*)::int as count
          from webhook_events
          where ($1::mollie_mode is null or mode = $1)
        `,
        [mode === "all" ? null : mode],
      ),
    ]);

    console.log(
      JSON.stringify(
        {
          policy: {
            records: RETENTION_POLICY,
            version: RETENTION_POLICY_VERSION,
          },
          reportKind,
          mode,
          counts: {
            auditCoreEvidence: auditResult.rows[0]?.count ?? 0,
            consentCoreEvidence: consentResult.rows[0]?.count ?? 0,
            webhookEvents: webhookResult.rows[0]?.count ?? 0,
          },
          proposedMutations: 0,
        },
        null,
        2,
      ),
    );
  } else {
    const [auditResult, consentResult, webhookResult] = await Promise.all([
      client.query(
        `
          select
            count(*)::int as core_evidence_count,
            count(*) filter (
              where created_at < now() - interval '180 days'
                and details <> '{}'::jsonb
            )::int as review_candidate_count
          from audit_logs
          where mode = $1
        `,
        [mode],
      ),
      client.query(
        `
          select
            count(*)::int as core_evidence_count,
            count(*) filter (
              where accepted_at < now() - interval '12 months'
                and (accepted_ip is not null or accepted_user_agent is not null)
            )::int as review_candidate_count
          from subscription_onboarding_consents
          where mode = $1
        `,
        [mode],
      ),
      client.query(
        `
          select
            count(*) filter (
              where processing_status = 'processed'
                and retry_count = 0
                and received_at < now() - interval '180 days'
                and payload <> '{}'::jsonb
            )::int as review_candidate_count,
            count(*) filter (
              where processing_status = 'failed'
            )::int as unresolved_failed_preserved_count
          from webhook_events
          where mode = $1
        `,
        [mode],
      ),
    ]);

    console.log(
      JSON.stringify(
        {
          policyVersion: RETENTION_POLICY_VERSION,
          reportKind,
          mode,
          windowsDays: {
            auditDetails: RETENTION_WINDOWS.auditDetails,
            consentClientDataMonths:
              RETENTION_WINDOWS.acceptedConsentClientDataMonths,
            processedWebhookPayload: RETENTION_WINDOWS.processedWebhookPayload,
          },
          plans: {
            auditDetails: {
              candidateCount: auditResult.rows[0]?.review_candidate_count ?? 0,
              evidenceImpact: "The audit row and core event evidence remain preserved.",
              intendedAction: "Manual review only; no automatic JSONB redaction is approved.",
              status: "review_only",
            },
            consentIpOrUserAgent: {
              candidateCount: consentResult.rows[0]?.review_candidate_count ?? 0,
              evidenceImpact: "Core accepted consent, terms, checkbox, and plan evidence remain preserved.",
              intendedAction: "Potentially redact accepted_ip and accepted_user_agent after evidence review.",
              status: "potential_redaction",
            },
            processedWebhookPayload: {
              candidateCount: webhookResult.rows[0]?.review_candidate_count ?? 0,
              evidenceImpact: "Normalized webhook event facts and processing outcome remain preserved.",
              intendedAction: "Potentially replace only the raw payload with an empty object.",
              status: "potential_redaction",
            },
          },
          preservedCounts: {
            auditCoreEvidence: auditResult.rows[0]?.core_evidence_count ?? 0,
            consentCoreEvidence: consentResult.rows[0]?.core_evidence_count ?? 0,
            unresolvedFailedWebhookPayload:
              webhookResult.rows[0]?.unresolved_failed_preserved_count ?? 0,
          },
          blockedPendingAllowlists: {
            genericMetadata: "Blocked until field-specific evidence and redaction rules exist.",
            testOperationalData: "Blocked until table-specific rules exclude live-linked evidence.",
          },
          proposedMutations: 0,
        },
        null,
        2,
      ),
    );
  }
} finally {
  try {
    await client.query("ROLLBACK");
  } finally {
    client.release();
    await pool.end();
  }
}
