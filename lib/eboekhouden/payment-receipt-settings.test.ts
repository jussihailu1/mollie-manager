import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { sql, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import { loadIsolated } from "../testing/isolated-module";
import * as configuration from "./payment-receipt-configuration";
import * as pagination from "./pagination";

let db: PGlite;
const dialect = new PgDialect();
before(async () => {
  db = new PGlite();
  const baseline = JSON.parse(readFileSync("db/drizzle/meta/0029_snapshot.json", "utf8"));
  for (const statement of await generateMigration(generateDrizzleJson({}), baseline)) await db.exec(statement);
  await db.exec(readFileSync("db/drizzle/0031_eboekhouden_payment_receipts.sql", "utf8"));
});
after(async () => { await db?.close(); });

async function fixture() {
  const tenantId = `settings${randomUUID().replaceAll("-", "")}`;
  await db.query("insert into tenants (id,slug,name) values ($1,$1,'Fixture')", [tenantId]);
  await db.query("insert into tenant_eboekhouden_credentials (id,tenant_id,api_source,api_token_ciphertext,updated_at) values ($1,$1,'fixture','not-a-secret','2026-11-01T12:00:00Z')", [tenantId]);
  const state = { providerCalls: 0, freshSession: false, audits: [] as { action: string; entityId: string }[], auditFails: false,
    selectedProfile: "pfl_fixture" as string | undefined, actualProfile: "pfl_fixture", ledgerCategory: "FIN",
    profileHook: undefined as (() => Promise<void>) | undefined };
  const execute = (statement: SQL) => { const query = dialect.sqlToQuery(statement); return db.query(query.sql, query.params); };
  const scoped = (tenant: string, mode: string) => { assert.equal(tenant, tenantId); assert.equal(mode, "live"); state.providerCalls++; };
  const profile = async () => { state.providerCalls++; await state.profileHook?.(); return { id: state.actualProfile }; };
  const loaded = loadIsolated<typeof import("./payment-receipt-settings")>("lib/eboekhouden/payment-receipt-settings.ts", {
    "server-only": {}, "drizzle-orm": { sql },
    "@/lib/db": {
      getDb: () => ({ execute }),
      transaction: async (work: (tx: { execute: (statement: SQL) => Promise<unknown> }) => Promise<unknown>) => db.transaction(async transaction => work({
        execute: async statement => { const query = dialect.sqlToQuery(statement); return transaction.query(query.sql, query.params); },
      })),
    },
    "@/lib/audit": { writeAuditLog: async (entry: { action: string; entityId: string }, tx: unknown, actor: { kind: string }) => {
      assert.ok(tx); assert.equal(actor.kind, "system"); state.audits.push(entry); if (state.auditFails) throw new Error("Audit unavailable");
    } },
    "@/lib/mollie/client": {
      getTenantMollieClient: async (tenant: string, mode: string) => { scoped(tenant, mode); return { profiles: {
        get: async (id: string) => { assert.equal(id, state.selectedProfile); return profile(); }, getCurrent: profile,
      } }; },
      getTenantMollieRequestContext: async (tenant: string, mode: string) => { scoped(tenant, mode); return { profileId: state.selectedProfile }; },
    },
    "./client": { refreshEboekhoudenSession: async (tenant: string) => { assert.equal(tenant, tenantId); state.providerCalls++; state.freshSession = true; },
      listEboekhoudenLedgers: async (input: { tenantId: string }) => {
      assert.equal(input.tenantId, tenantId); assert.equal(state.freshSession, true, "Account mapping must use a freshly authenticated administration");
      state.providerCalls++; return { items: [{ id: 3, category: state.ledgerCategory }] };
    } },
    "./pagination": pagination, "./payment-receipt-configuration": configuration,
  });
  const command: configuration.ReceiptConfigurationCommand = { tenantId, action: "enable", apply: true, profileId: "pfl_fixture",
    clearingLedgerId: 3, paymentsFrom: "2099-06-01T00:00:00Z" };
  const current = () => db.query<{ enabled: boolean; profile_id: string; clearing_ledger_id: number; payments_from: Date }>(
    "select * from tenant_eboekhouden_receipt_settings where tenant_id=$1", [tenantId]);
  const insertClaim = async () => {
    await db.query("insert into payments (id,tenant_id,mode,payment_type,mollie_payment_id,amount_value,amount_currency) values ($1,$1,'live','first',$2,19.99,'EUR')", [tenantId, `tr_${tenantId}`]);
    await db.query("insert into invoices (id,tenant_id,mode,owner_type,owner_id,provider) values ($1,$1,'live','payment',$1,'eboekhouden')", [tenantId]);
    await db.query(`insert into eboekhouden_payment_receipts (id,tenant_id,mode,payment_id,invoice_id,mollie_payment_id,profile_id,clearing_ledger_id,credential_version,payload,invoice_snapshot)
      values ($1,$1,'live',$1,$1,$2,'pfl_fixture',3,'2026-11-01T12:00:00Z','{}','{}')`, [tenantId, `tr_${tenantId}`]);
  };
  return { tenantId, state, command, current, insertClaim, configure: loaded.configureTenantReceiptAutomation };
}

test("setup preview validates the actual profile and FIN account without saving or auditing", async () => {
  const f = await fixture(); const result = await f.configure({ ...f.command, apply: false });
  assert.equal(result.applied, false); assert.ok(f.state.providerCalls > 0);
  assert.equal((await f.current()).rows.length, 0); assert.equal(f.state.audits.length, 0);
});

test("apply saves tenant-owned configuration and its audit in one real PostgreSQL transaction", async () => {
  const f = await fixture(); assert.equal((await f.configure(f.command)).applied, true);
  const row = (await f.current()).rows[0]; assert.equal(row.enabled, true); assert.equal(row.clearing_ledger_id, 3); assert.equal(row.profile_id, "pfl_fixture");
  assert.deepEqual(f.state.audits.map(a => [a.action, a.entityId]), [["eboekhouden.receipt_settings.enable", f.tenantId]]);
});

test("audit failure rolls back the settings write", async () => {
  const f = await fixture(); f.state.auditFails = true;
  await assert.rejects(() => f.configure(f.command), /Audit unavailable/); assert.equal((await f.current()).rows.length, 0);
});

test("credential changes between provider verification and save abort configuration", async () => {
  const f = await fixture(); f.state.profileHook = async () => {
    await db.query("update tenant_eboekhouden_credentials set updated_at=updated_at+interval '1 second' where tenant_id=$1", [f.tenantId]);
  };
  await assert.rejects(() => f.configure(f.command), /credentials changed/);
  assert.equal((await f.current()).rows.length, 0); assert.equal(f.state.audits.length, 0);
});

test("a non-financial account or wrong provider profile cannot be applied", async () => {
  for (const change of ["ledger", "profile"] as const) {
    const f = await fixture(); if (change === "ledger") f.state.ledgerCategory = "VW"; else f.state.actualProfile = "pfl_other";
    await assert.rejects(() => f.configure(f.command), /does not match/); assert.equal((await f.current()).rows.length, 0);
  }
});

test("API-key configuration verifies getCurrent when no OAuth selected profile exists", async () => {
  const f = await fixture(); f.state.selectedProfile = undefined;
  assert.equal((await f.configure(f.command)).applied, true); assert.equal((await f.current()).rows[0].profile_id, "pfl_fixture");
});

test("existing claims prevent profile, account, cutover or credential rebinding but permit unchanged re-enable", async () => {
  for (const change of ["profile", "ledger", "cutover", "credential"] as const) {
    const f = await fixture(); await f.configure(f.command); await f.insertClaim();
    let next = { ...f.command };
    if (change === "profile") { f.state.selectedProfile = "pfl_other"; f.state.actualProfile = "pfl_other"; next = { ...next, profileId: "pfl_other" }; }
    if (change === "ledger") { await db.query("update tenant_eboekhouden_receipt_settings set clearing_ledger_id=4 where tenant_id=$1", [f.tenantId]); }
    if (change === "cutover") next = { ...next, paymentsFrom: "2099-07-01T00:00:00Z" };
    if (change === "credential") await db.query("update tenant_eboekhouden_credentials set updated_at=updated_at+interval '1 second' where tenant_id=$1", [f.tenantId]);
    await assert.rejects(() => f.configure(next), /Existing receipt claims/); assert.equal((await db.query("select id from eboekhouden_payment_receipts where tenant_id=$1", [f.tenantId])).rows.length, 1);
  }
  const f = await fixture(); await f.configure(f.command); await f.insertClaim();
  await f.configure({ action: "disable", tenantId: f.tenantId, apply: true });
  assert.equal((await f.configure(f.command)).applied, true); assert.equal((await f.current()).rows[0].enabled, true);
});

test("disable makes no provider calls, keeps receipt evidence and affects only the selected tenant", async () => {
  const f = await fixture(); const other = await fixture(); await f.configure(f.command); await other.configure(other.command); await f.insertClaim();
  f.state.providerCalls = 0;
  await f.configure({ action: "disable", tenantId: f.tenantId, apply: false }); assert.equal((await f.current()).rows[0].enabled, true);
  await f.configure({ action: "disable", tenantId: f.tenantId, apply: true });
  assert.equal(f.state.providerCalls, 0); assert.equal((await f.current()).rows[0].enabled, false); assert.equal((await other.current()).rows[0].enabled, true);
  assert.equal((await db.query("select id from eboekhouden_payment_receipts where tenant_id=$1", [f.tenantId])).rows.length, 1);
});
