// Run with node --env-file=<env-file> --import tsx
// scripts/verify-recurring-payment-recovery.ts. Only session-local temporary
// tables are written, and the entire test transaction is rolled back.
import assert from "node:assert/strict";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Payment } from "@mollie/api-client";
import * as schema from "../db/schema";
import { createRequire } from "node:module";
import type { DbClient } from "../lib/db";

// Node is a server here, but server-only's default export is a bundler guard.
// Disable only that guard for this isolated test; keep the normal React runtime.
const requireForTest = createRequire(import.meta.url);
requireForTest.cache[requireForTest.resolve("server-only")] = { exports: {} } as NodeJS.Module;

async function main() {
  const { persistSyncedPayment } = await import("../lib/reliability/sync-persistence");
  const { bindRecoveredWebhookEvents, markRecoveredPaymentWebhooksProcessed } = await import("../lib/reliability/recurring-payment-recovery");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === "true" ? true : undefined });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // LIKE does not copy foreign keys or triggers. All unqualified writes from
    // the production functions resolve to these pg_temp tables.
    for (const table of ["customers", "mandates", "subscriptions", "payments", "payment_links", "recurring_billing_schedules", "audit_logs", "webhook_events"]) {
      await client.query(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES) ON COMMIT DROP`);
    }
    await client.query("ALTER TABLE webhook_events ALTER COLUMN mode DROP NOT NULL");
    await client.query(`INSERT INTO subscriptions (id,tenant_id,customer_id,mode,description,interval,amount_value,amount_currency)
      VALUES ('sub_local','owner','customer_local','live','Hosting','1 month',19.99,'EUR')`);
    await client.query(`INSERT INTO recurring_billing_schedules (id,tenant_id,subscription_id,mode,planned_collection_date,
      invoice_send_due_date,invoice_state,collection_state,amount_value,amount_currency,metadata)
      VALUES ('schedule','owner','sub_local','live','2026-09-10','2026-09-05','invoice_sent','not_applicable',19.99,'EUR',
        '{"eboekhoudenInvoice":{"invoiceNumber":"F00051"}}')`);
    await client.query(`INSERT INTO webhook_events (id,mode,tenant_id,resource_id,processing_status)
      VALUES ('old1',NULL,NULL,'tr_recovered','failed'),('old2','test',NULL,'tr_recovered','failed'),
        ('unrelated',NULL,NULL,'tr_unrelated','failed')`);
    // Production types carry a Pool $client. The execute interface is identical
    // here, but one bound connection is needed for temporary-table isolation.
    const db = drizzle(client, { schema }) as unknown as DbClient;
    const payment = { id: "tr_recovered", mode: "live", customerId: "cst_owner", subscriptionId: "sub_provider",
      status: "paid", sequenceType: "recurring", createdAt: "2026-09-10T02:00:00Z", paidAt: "2026-09-11T00:25:00Z",
      amount: { value: "19.99", currency: "EUR" }, getCheckoutUrl: () => null } as unknown as Payment;
    for (let attempt = 0; attempt < 2; attempt++) {
      await persistSyncedPayment(db, {
        actor: { kind: "system" }, mode: "live", tenantId: "owner", customerId: "customer_local",
        localMandateId: null, localSubscriptionId: "sub_local", payment, paymentType: "recurring",
        recurringCollectionState: "settled", collectionReviewRequiredAt: null,
      });
    }
    const persisted = await client.query("SELECT id FROM payments WHERE mollie_payment_id = 'tr_recovered'");
    assert.equal(persisted.rows.length, 1);
    const schedules = await client.query("SELECT payment_id,invoice_state,collection_state,metadata FROM recurring_billing_schedules");
    assert.equal(schedules.rows.length, 1);
    assert.equal(schedules.rows[0].payment_id, persisted.rows[0].id);
    assert.equal(schedules.rows[0].invoice_state, "invoice_sent");
    assert.equal(schedules.rows[0].collection_state, "settled");
    assert.equal(schedules.rows[0].metadata.eboekhoudenInvoice.invoiceNumber, "F00051");
    assert.equal(await bindRecoveredWebhookEvents({ tenantId: "other", mode: "live" }, db), 0);
    assert.equal(await bindRecoveredWebhookEvents({ tenantId: "owner", mode: "test" }, db), 0);
    assert.equal(await bindRecoveredWebhookEvents({ tenantId: "owner", mode: "live" }, db), 2);
    const events = await client.query("SELECT mode,tenant_id FROM webhook_events WHERE resource_id='tr_recovered'");
    assert.ok(events.rows.every((event) => event.mode === "live" && event.tenant_id === "owner"));
    assert.equal(await markRecoveredPaymentWebhooksProcessed({ tenantId: "owner", mode: "live", subscriptionIds: [] }, db), 0);
    assert.equal(await markRecoveredPaymentWebhooksProcessed({ tenantId: "owner", mode: "live", subscriptionIds: ["sub_local"] }, db), 2);
    const processed = await client.query("SELECT processing_status FROM webhook_events WHERE resource_id='tr_recovered'");
    assert.ok(processed.rows.every((event) => event.processing_status === "processed"));
    // A duplicate provider ID belonging to another tenant must never be claimed.
    await client.query(`INSERT INTO payments (id,tenant_id,mode,payment_type,mollie_payment_id,amount_value,amount_currency)
      VALUES ('collision','other','live','recurring','tr_recovered',19.99,'EUR')`);
    await client.query("UPDATE webhook_events SET tenant_id=NULL,mode=NULL,processing_status='failed' WHERE resource_id='tr_recovered'");
    assert.equal(await bindRecoveredWebhookEvents({ tenantId: "owner", mode: "live" }, db), 0);
    console.log("PASS: duplicate-safe payment recovery preserves F00051 and binds only uniquely owned live webhooks. All writes isolated in temporary tables.");
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Recovery verification failed"); process.exitCode = 1; });
