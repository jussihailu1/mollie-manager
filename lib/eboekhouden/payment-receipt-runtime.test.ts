import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { sql, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import { loadIsolated } from "../testing/isolated-module";
import * as pagination from "./pagination";
import * as preview from "./payment-receipt-preview";
import type { EboekhoudenLedger } from "./client";
import type { SalesMutation } from "./invoice-posting";
import type { ReceiptSettings } from "./payment-receipt-contract";

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
  const tenantId = `runtime${randomUUID().replaceAll("-", "")}`;
  const paymentId = `${tenantId}payment`, invoiceId = `${tenantId}invoice`, customerId = `${tenantId}customer`;
  const molliePaymentId = `tr_${tenantId}`;
  await db.query("insert into tenants (id,slug,name) values ($1,$1,'Fixture')", [tenantId]);
  await db.query("insert into customers (id,tenant_id,mode,email,mollie_customer_id) values ($1,$2,'live','fixture@example.test','cst_fixture')", [customerId, tenantId]);
  await db.query(`insert into payments (id,tenant_id,mode,customer_id,payment_type,mollie_payment_id,mollie_status,paid_at,amount_value,amount_currency)
    values ($1,$2,'live',$3,'first',$4,'paid','2026-06-10T23:55:13Z',19.99,'EUR')`, [paymentId, tenantId, customerId, molliePaymentId]);
  await db.query(`insert into invoices (id,tenant_id,mode,owner_type,owner_id,provider,provider_invoice_id,provider_invoice_number,provider_customer_id)
    values ($1,$2,'live','payment',$3,'eboekhouden','100','FTEST','20')`, [invoiceId, tenantId, paymentId]);
  await db.query(`insert into customer_accounting_links (id,tenant_id,mode,customer_id,provider,provider_customer_id,link_status)
    values ($1,$1,'live',$2,'eboekhouden','20','linked')`, [tenantId, customerId]);
  const settings: ReceiptSettings = { tenantId, mode: "live", enabled: true, profileId: "pfl_fixture", clearingLedgerId: 3,
    paymentsFrom: "2026-06-01T00:00:00Z", credentialVersion: "2026-05-01T00:00:00Z" };
  const state = {
    dbReads: 0, providerCalls: [] as { name: string; input: unknown }[], requestedDetails: [] as number[],
    requestContext: { profileId: "pfl_fixture" } as { profileId?: string; testmode?: true }, invoiceResponseId: 100,
    wrongDetailId: false, invalidPage: "" as "" | "mutation" | "ledger" | "outstanding", repeatedPages: false,
    invoiceIndex: [{ id: 337 }] as { id: number }[], referenceIndex: [] as { id: number }[],
    dateIndex: [{ id: 337 }, { id: 700 }] as { id: number }[],
    ledgers: [{ id: 1, category: "DEB" }, { id: 2, category: "VW" }, { id: 3, category: "FIN" }] as EboekhoudenLedger[],
    outstanding: [{ id: 337, mutationId: 337, invoiceNumber: "FTEST", relationId: 20, totalAmount: 19.99, paidAmount: 0, outstandingAmount: 19.99 }],
  };
  const scoped = (name: string, input: { tenantId: string }) => { assert.equal(input.tenantId, tenantId); state.providerCalls.push({ name, input }); };
  const mutations: Record<number, SalesMutation> = {
    337: { id: 337, type: 2, date: "2026-06-01", invoiceNumber: "FTEST", relationId: 20, ledgerId: 1, inExVat: "EX",
      rows: [{ ledgerId: 2, vatCode: "GEEN", amount: 19.99 }] },
    700: { id: 700, type: 7, date: "2026-06-11", description: "Manual journal", rows: [{ ledgerId: 1, relationId: 20, vatCode: "GEEN", amount: 19.99 }] },
  };
  const loaded = loadIsolated<typeof import("./payment-receipt-runtime")>("lib/eboekhouden/payment-receipt-runtime.ts", {
    "server-only": {}, "drizzle-orm": { sql },
    "@/lib/db": { getDb: () => ({ execute: async (statement: SQL) => { state.dbReads++; const query = dialect.sqlToQuery(statement); return db.query(query.sql, query.params); } }) },
    "@/lib/mollie/client": {
      getTenantMollieClient: async (tenant: string, mode: string) => { scoped("mollie-client", { tenantId: tenant }); assert.equal(mode, "live"); return { payments: {
        get: async (id: string) => { assert.equal(id, molliePaymentId); state.providerCalls.push({ name: "payment", input: id });
          return { resource: "payment", id, mode: "live", profileId: "pfl_fixture", customerId: "cst_fixture", sequenceType: "first",
            status: "paid", paidAt: "2026-06-10T23:55:13Z", amount: { value: "19.99", currency: "EUR" },
            amountRefunded: { value: "0.00", currency: "EUR" }, amountRemaining: { value: "19.99", currency: "EUR" }, _links: {} };
        },
      } }; },
      getTenantMollieRequestContext: async (tenant: string, mode: string) => { scoped("mollie-context", { tenantId: tenant }); assert.equal(mode, "live"); return state.requestContext; },
    },
    "./client": {
      refreshEboekhoudenSession: async (tenant: string) => { scoped("accounting-session", { tenantId: tenant }); },
      listEboekhoudenMutations: async (input: { tenantId: string; limit: number; offset: number; invoiceNumber?: string; description?: string; date?: string }) => {
        scoped("mutations", input); if (state.invalidPage === "mutation") return {};
        const list = input.invoiceNumber ? state.invoiceIndex : input.description ? state.referenceIndex : state.dateIndex;
        if (state.repeatedPages && input.invoiceNumber) return { items: Array.from({ length: 500 }, (_, index) => ({ id: index + 1000 })) };
        return { items: list.slice(input.offset, input.offset + input.limit), count: 1 };
      },
      getEboekhoudenMutation: async (id: number, tenant: string) => { scoped("detail", { tenantId: tenant }); state.requestedDetails.push(id);
        return { ...(mutations[id] ?? { id, type: 7 }), id: state.wrongDetailId ? id + 1 : id }; },
      getEboekhoudenInvoice: async (id: number, tenant: string) => { scoped("invoice", { tenantId: tenant }); assert.equal(id, 100);
        return { id: state.invoiceResponseId, invoiceNumber: "FTEST", relationId: 20, date: "2026-06-01", reference: "FP-original", termOfPayment: 9,
          inExVat: "EX", totalAmount: 19.99, totalExcl: 19.99, vatAmount: 0,
          items: [{ quantity: 1, pricePerUnit: 19.99, vatCode: "GEEN", ledgerId: 2, description: "Hosting" }] }; },
      listEboekhoudenLedgers: async (input: { tenantId: string; limit: number; offset: number }) => {
        scoped("ledgers", input); return state.invalidPage === "ledger" ? {} : { items: state.ledgers.slice(input.offset, input.offset + input.limit), count: 1 }; },
      listEboekhoudenOutstanding: async (input: { tenantId: string; invoiceNumber: string; limit: number; offset: number }) => {
        scoped("outstanding", input); assert.equal(input.invoiceNumber, "FTEST");
        return state.invalidPage === "outstanding" ? {} : { items: state.outstanding.slice(input.offset, input.offset + input.limit), count: 1 }; },
    },
    "./pagination": pagination, "./payment-receipt-preview": preview,
  });
  return { tenantId, paymentId, invoiceId, customerId, molliePaymentId, settings, state, loaded,
    load: () => loaded.loadReceiptContext(settings, paymentId) };
}

test("actual SQL joins load only this tenant's live invoice/payment binding and linked relation", async () => {
  const f = await fixture(); await fixture();
  const links = await f.loaded.listReceiptLinks(f.settings); assert.equal(links.length, 1);
  assert.equal(links[0].paymentId, f.paymentId); assert.equal(links[0].invoiceId, f.invoiceId);
  assert.equal(links[0].tenantId, f.tenantId); assert.equal(links[0].relationId, 20); assert.equal(links[0].amount.value, "19.99");
  await db.query("update customer_accounting_links set link_status='needs_review' where tenant_id=$1", [f.tenantId]);
  assert.equal((await f.loaded.listReceiptLinks(f.settings))[0].relationId, 0);
});

test("SQL excludes voided invoices, other providers and broken cross-tenant owner references", async () => {
  for (const kind of ["void", "provider", "owner"] as const) {
    const f = await fixture();
    if (kind === "void") await db.query("update invoices set voided_at=now() where id=$1", [f.invoiceId]);
    if (kind === "provider") await db.query("update invoices set provider='mollie' where id=$1", [f.invoiceId]);
    if (kind === "owner") { const other = await fixture(); await db.query("update invoices set owner_id=$2 where id=$1", [f.invoiceId, other.paymentId]); }
    assert.equal((await f.loaded.listReceiptLinks(f.settings)).length, 0);
    await assert.rejects(f.load, /ownership/); assert.equal(f.state.providerCalls.length, 0);
  }
});

test("recurring SQL binds the invoice to its exact schedule, payment, subscription and customer", async () => {
  const f = await fixture(); const subscriptionId = `${f.tenantId}subscription`, scheduleId = `${f.tenantId}schedule`;
  await db.query(`insert into subscriptions (id,tenant_id,customer_id,mode,mollie_subscription_id,description,interval,amount_value,amount_currency)
    values ($1,$2,$3,'live','sub_fixture','Hosting','1 month',19.99,'EUR')`, [subscriptionId, f.tenantId, f.customerId]);
  await db.query("update payments set payment_type='recurring',subscription_id=$2 where id=$1", [f.paymentId, subscriptionId]);
  await db.query(`insert into recurring_billing_schedules (id,tenant_id,subscription_id,mode,planned_collection_date,invoice_send_due_date,payment_id,amount_value,amount_currency)
    values ($1,$2,$3,'live','2026-06-11','2026-06-01',$4,19.99,'EUR')`, [scheduleId, f.tenantId, subscriptionId, f.paymentId]);
  await db.query("update invoices set owner_type='recurring_schedule',owner_id=$2 where id=$1", [f.invoiceId, scheduleId]);
  const links = await f.loaded.listReceiptLinks(f.settings); assert.equal(links.length, 1);
  assert.equal(links[0].ownerId, scheduleId); assert.equal(links[0].schedulePaymentId, f.paymentId);
  assert.equal(links[0].mollieSubscriptionId, "sub_fixture"); assert.equal(links[0].customerId, f.customerId);
  await db.query("update payments set subscription_id=null where id=$1", [f.paymentId]);
  assert.equal((await f.loaded.listReceiptLinks(f.settings)).length, 0);
});

test("all runtime entry points reject missing tenant and non-live mode before database/provider I/O", async () => {
  const f = await fixture();
  for (const scope of [{ ...f.settings, tenantId: "" }, { ...f.settings, mode: "test" }] as const) {
    await assert.rejects(() => f.loaded.listReceiptLinks(scope as never));
    await assert.rejects(() => f.loaded.listUnverifiedReceiptPaymentIds(scope as never));
    await assert.rejects(() => f.loaded.loadReceiptContext(scope as never, f.paymentId));
  }
  assert.equal(f.state.dbReads, 0); assert.equal(f.state.providerCalls.length, 0);
});

test("invoice, payment-reference and Amsterdam-date searches include manual rows and deduplicate detail reads", async () => {
  const f = await fixture(); const result = await f.load();
  assert.deepEqual(f.state.requestedDetails, [337, 700]); assert.equal(result.mutations.find(m => m.id === 700)?.type, 7);
  const searches = f.state.providerCalls.filter(call => call.name === "mutations").map(call => call.input as Record<string, unknown>);
  assert.ok(searches.some(q => q.invoiceNumber === "FTEST")); assert.ok(searches.some(q => q.description === `%${f.molliePaymentId}%`));
  assert.ok(searches.some(q => q.date === "2026-06-11")); assert.ok(searches.every(q => !("type" in q)));
  assert.equal(preview.previewPaymentReceipt({ ...result, ...f.settings }).status, "review_required");
});

test("full pages continue despite a misleading count and all ledger/outstanding pages are collected", async () => {
  const f = await fixture();
  f.state.invoiceIndex = Array.from({ length: 501 }, (_, index) => ({ id: 1000 + index }));
  f.state.ledgers = Array.from({ length: 501 }, (_, index) => ({ id: 2000 + index, category: "VW" }));
  f.state.outstanding = Array.from({ length: 501 }, (_, index) => ({ id: 3000 + index, mutationId: 3000 + index, invoiceNumber: "FTEST", relationId: 20, totalAmount: 19.99, paidAmount: 0, outstandingAmount: 19.99 }));
  const result = await f.load(); assert.equal(result.mutations.length, 503); assert.equal(result.ledgers.length, 501); assert.equal(result.outstanding.length, 501);
  for (const name of ["mutations", "ledgers", "outstanding"]) assert.ok(f.state.providerCalls.some(call => call.name === name && (call.input as { offset?: number }).offset === 500));
});

test("changed OAuth profile or test context fails before payment/accounting reads", async () => {
  for (const requestContext of [{ profileId: "pfl_other" }, { profileId: "pfl_fixture", testmode: true as const }]) {
    const f = await fixture(); f.state.requestContext = requestContext;
    await assert.rejects(f.load, /profile changed/);
    assert.ok(f.state.providerCalls.every(call => ["mollie-client", "mollie-context"].includes(call.name)));
  }
});

test("invalid or ambiguous textual provider invoice IDs fail before calling providers", async () => {
  for (const id of ["1e2", "100.0", " 100", "0", "-1", "9007199254740992", "invalid"]) {
    const f = await fixture(); await db.query("update invoices set provider_invoice_id=$2 where id=$1", [f.invoiceId, id]);
    await assert.rejects(f.load, /Invoice identity/); assert.equal(f.state.providerCalls.length, 0);
  }
});

test("a mismatched invoice response or mutation detail identity aborts the read proof", async () => {
  const f = await fixture(); f.state.invoiceResponseId = 101; await assert.rejects(f.load, /Invoice identity/);
  const g = await fixture(); g.state.wrongDetailId = true; await assert.rejects(g.load, /Mutation identity/);
});

test("missing pages and repeated page IDs are rejected rather than treated as complete history", async () => {
  for (const invalidPage of ["mutation", "ledger", "outstanding"] as const) {
    const f = await fixture(); f.state.invalidPage = invalidPage; await assert.rejects(f.load, /incomplete scan/);
  }
  const f = await fixture(); f.state.repeatedPages = true; await assert.rejects(f.load, /repeated ID/);
});
