#!/usr/bin/env node

import nextEnv from "@next/env";
import pg from "pg";

const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());

const mode = process.argv[2] === "live" ? "live" : "test";
const apply = process.argv[3] === "--apply";
const limit = Math.max(1, Math.min(500, Number(process.argv[4] ?? "200")));
const connectionString = process.env.DATABASE_URL;
const useSsl = process.env.DATABASE_SSL === "true";

if (!connectionString) {
  throw new Error("DATABASE_URL is required for safe failed requeue.");
}

const { Pool } = pg;
const pool = new Pool({
  connectionString,
  ssl: useSsl ? true : undefined,
});

try {
  const recurringCandidates = await pool.query(
    `
      select
        rbs.id as schedule_id
      from recurring_billing_schedules rbs
      where rbs.mode = $1
        and rbs.invoice_state = 'invoice_failed'
        and rbs.eboekhouden_invoice_id is null
        and rbs.eboekhouden_invoice_number is null
        and (
          coalesce(rbs.metadata ->> 'invoiceCreationError', '') like '%FACT_014%'
          or coalesce(rbs.metadata ->> 'invoiceCreationError', '') like '%FACT_VERWERK_004%'
        )
      order by rbs.updated_at asc, rbs.created_at asc
      limit $2
    `,
    [mode, limit],
  );
  const firstPaymentCandidates = await pool.query(
    `
      select
        p.id as payment_id
      from payments p
      where p.mode = $1
        and p.payment_type = 'first'
        and p.invoice_state = 'invoice_failed'
        and p.eboekhouden_invoice_id is null
        and p.eboekhouden_invoice_number is null
        and (
          coalesce(p.metadata ->> 'invoiceCreationError', '') like '%FACT_014%'
          or coalesce(p.metadata ->> 'invoiceCreationError', '') like '%FACT_VERWERK_004%'
        )
      order by p.updated_at asc, p.created_at asc
      limit $2
    `,
    [mode, limit],
  );

  const recurringIds = recurringCandidates.rows.map((row) => row.schedule_id);
  const firstPaymentIds = firstPaymentCandidates.rows.map((row) => row.payment_id);

  const report = {
    apply,
    candidates: {
      firstPaymentIds,
      recurringIds,
    },
    mode,
    queued: {
      firstPaymentCount: 0,
      recurringCount: 0,
    },
    timestamp: new Date().toISOString(),
  };

  if (!apply) {
    report.nextStep =
      "Re-run with --apply to queue these retry-safe failed rows back to pending_invoice.";
    console.log(JSON.stringify(report, null, 2));
    process.exit(0);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    let queuedRecurringCount = 0;
    let queuedFirstPaymentCount = 0;

    if (recurringIds.length > 0) {
      const recurringUpdate = await client.query(
        `
          update recurring_billing_schedules
          set
            invoice_state = 'pending_invoice',
            invoice_failed_at = null,
            metadata = coalesce(metadata, '{}'::jsonb) || $3::jsonb,
            updated_at = now()
          where id = any($1::text[])
            and mode = $2
            and invoice_state = 'invoice_failed'
            and eboekhouden_invoice_id is null
            and eboekhouden_invoice_number is null
          returning id
        `,
        [
          recurringIds,
          mode,
          JSON.stringify({
            invoiceRetryQueuedAt: new Date().toISOString(),
            invoiceRetryQueuedBy: "ops:invoice-requeue-safe-failed",
            invoiceRetryReason:
              "Safe known validation failure code (FACT_014 / FACT_VERWERK_004).",
          }),
        ],
      );
      queuedRecurringCount = recurringUpdate.rowCount;
    }

    if (firstPaymentIds.length > 0) {
      const firstPaymentUpdate = await client.query(
        `
          update payments
          set
            invoice_state = 'pending_invoice',
            invoice_failed_at = null,
            metadata = coalesce(metadata, '{}'::jsonb) || $3::jsonb,
            updated_at = now()
          where id = any($1::text[])
            and mode = $2
            and payment_type = 'first'
            and invoice_state = 'invoice_failed'
            and eboekhouden_invoice_id is null
            and eboekhouden_invoice_number is null
          returning id
        `,
        [
          firstPaymentIds,
          mode,
          JSON.stringify({
            invoiceRetryQueuedAt: new Date().toISOString(),
            invoiceRetryQueuedBy: "ops:invoice-requeue-safe-failed",
            invoiceRetryReason:
              "Safe known validation failure code (FACT_014 / FACT_VERWERK_004).",
          }),
        ],
      );
      queuedFirstPaymentCount = firstPaymentUpdate.rowCount;
    }

    await client.query("COMMIT");

    report.queued = {
      firstPaymentCount: queuedFirstPaymentCount,
      recurringCount: queuedRecurringCount,
    };
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
