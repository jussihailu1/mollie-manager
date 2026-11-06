import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { findOrCreateActivationSubscription } from "./subscription-activation-provider";

// Execute the actual activation module with provider/database boundaries replaced.
// No production imports, secrets, SMTP, or network access are used by these tests.
function harness(options: { failCreate?: boolean; failSave?: boolean; profileId?: string; testmode?: true; paid?: boolean; mandate?: boolean } = {}) {
  const requests: Record<string, unknown>[] = [];
  const remote: Record<string, unknown>[] = [];
  let frozen: Record<string, unknown> | undefined;
  let saved = false;
  let failSave = options.failSave;
  let locked = false;
  let saves = 0;
  const queries: string[] = [];
  const execute = async (statement: Parameters<PgDialect["sqlToQuery"]>[0]) => {
    const query = new PgDialect().sqlToQuery(statement);
    queries.push(query.sql);
    if (query.sql.includes("update payment_links")) {
      frozen ??= JSON.parse(query.params.find((p) => typeof p === "string" && p.startsWith('{"amount"')) as string);
      return { rows: [{ request: frozen }] };
    }
    if (query.sql.includes("from customers")) return { rows: [{ id: "customer-1", mollieCustomerId: "cst_1", archivedAt: null }] };
    if (query.sql.includes("from subscription_onboarding_consents")) return { rows: [{ consentId: "consent-1", paymentLinkId: "link-1", firstPaymentMode: "mandate_only", planSnapshot: {} }] };
    if (query.sql.includes("from payments")) return { rows: options.paid === false ? [] : [{ id: "payment-1", paidAt: "2026-11-06", mollieStatus: "paid" }] };
    if (query.sql.includes("from mandates")) return { rows: options.mandate === false ? [] : [{ id: "mandate-1", mollieMandateId: "mdt_1", method: "directdebit", mollieStatus: "valid" }] };
    if (query.sql.includes("from subscriptions")) return { rows: saved ? [{ id: "consent-1", consentId: "consent-1", localStatus: "active" }] : [] };
    if (query.sql.includes("insert into subscriptions")) { saves++; if (failSave) { failSave = false; throw new Error("local commit failed"); } saved = true; }
    return { rows: [] };
  };
  const mocks: Record<string, unknown> = {
    "server-only": {}, "drizzle-orm": { sql },
    "@mollie/api-client": { MandateStatus: { valid: "valid", pending: "pending" }, PaymentMethod: { directdebit: "directdebit" } },
    "@/lib/db": { getDb: () => ({ execute }), transaction: async (fn: (db: { execute: typeof execute }) => unknown) => fn({ execute }), getDbPool: () => ({ connect: async () => ({
      query: async (text: string) => { if (text.includes("pg_try")) { if (locked) return { rows: [{ locked: false }] }; locked = true; return { rows: [{ locked: true }] }; } return { rows: [] }; },
      release: () => { locked = false; },
    }) }) },
    "@/lib/audit": { writeAuditLog: async () => {} },
    "@/lib/mollie/client": {
      getMollieWebhookUrl: () => "https://kify.app/api/webhooks/mollie",
      getTenantMollieRequestContext: async () => ({ profileId: options.profileId, testmode: options.testmode }),
      getTenantMollieClient: async () => ({ customerSubscriptions: {
        iterate: async function* () { for (const s of remote) yield s; },
        create: async (request: Record<string, unknown>) => { requests.push(JSON.parse(JSON.stringify(request))); if (options.failCreate) throw new Error("provider unavailable");
          const result = { ...request, id: "sub_1", status: "active", mode: options.testmode ? "test" : "live" }; remote.push(result); return result; },
      } }),
    },
    "@/lib/recurring-billing-schedule": { upsertRecurringBillingScheduleForSubscription: async () => {} },
    "@/lib/onboarding/subscription-activation-notifications": { queueSubscriptionActivationSuccessNotifications: async () => {} },
    "@/lib/reliability/alerts": { resolveAlertsForEntity: async () => {} },
    "@/lib/subscription-consent": { subscriptionConsentPlanSnapshotSchema: { safeParse: () => ({ success: true, data: { subscriptionAmountValue: "34.95", description: "Hosting", billingInterval: "monthly", startDate: "2026-12-01", subscriptionTermMode: "open_ended" } }) } },
    "@/lib/subscription-policy": { toMollieInterval: () => "1 month" },
    "@/lib/subscriptions": { mapSubscriptionLifecycle: () => "active" },
    "@/lib/onboarding/subscription-activation-provider": { findOrCreateActivationSubscription },
  };
  const exports: { attemptSubscriptionActivation?: (input: unknown) => Promise<{ status: string }> } = {};
  const code = ts.transpileModule(readFileSync("lib/onboarding/subscription-activation.ts", "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  runInNewContext(code, { exports, require: (name: string) => { assert.ok(name in mocks, name); return mocks[name]; }, Date: class extends Date { constructor(value?: string | number) { super(value ?? "2026-11-06T12:00:00Z"); } }, JSON, Error });
  return { requests, queries, saves: () => saves, run: (trigger = "auto") => exports.attemptSubscriptionActivation!({ customerId: "customer-1", tenantId: "tenant-1", mode: options.testmode ? "test" : "live", trigger }) };
}

it("sends the OAuth profile, preserves the agreed future date and creates no payment", async () => {
  const h = harness({ profileId: "pfl_1" }); assert.equal((await h.run()).status, "created");
  assert.equal(h.requests[0].profileId, "pfl_1"); assert.equal(h.requests[0].startDate, "2026-12-01");
  assert.deepEqual(h.requests[0].amount, { currency: "EUR", value: "34.95" });
  assert.equal((await h.run()).status, "already_exists"); assert.equal(h.requests.length, 1);
});
it("retries a failed request byte-for-byte, even switching from automatic to manual", async () => {
  const h = harness({ failCreate: true, profileId: "pfl_1" });
  assert.equal((await h.run()).status, "failed"); assert.equal((await h.run("manual")).status, "failed");
  assert.deepEqual(h.requests[0], h.requests[1]); assert.equal(h.requests[0].idempotencyKey, "subscription-onboarding:v2:live:consent-1");
});
it("repairs a failed local save by adopting the remote subscription without another create", async () => {
  const h = harness({ failSave: true }); assert.equal((await h.run()).status, "failed"); assert.equal((await h.run()).status, "created");
  assert.equal(h.requests.length, 1); assert.equal(h.saves(), 2); assert.equal("profileId" in h.requests[0], false);
});
it("keeps test-mode creation explicitly in test mode", async () => {
  const h = harness({ profileId: "pfl_1", testmode: true }); await h.run(); assert.equal(h.requests[0].testmode, true);
});
for (const option of [{ paid: false }, { mandate: false }]) it(`does not create without prerequisites ${JSON.stringify(option)}`, async () => {
  const h = harness(option); assert.equal((await h.run()).status, "pending_prerequisites"); assert.equal(h.requests.length, 0);
});
it("serializes concurrent activation attempts", async () => {
  const h = harness(); const results = await Promise.all([h.run(), h.run()]);
  assert.equal(h.requests.length, 1); assert.ok(results.some((result) => result.status === "pending_prerequisites"));
});
