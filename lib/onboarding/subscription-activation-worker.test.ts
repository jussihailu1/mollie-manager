import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

function load(path: string, mocks: Record<string, unknown>, extras = {}) {
  const exports: Record<string, (...args: never[]) => Promise<unknown>> = {};
  runInNewContext(ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
    { exports, require: (name: string) => { assert.ok(name in mocks, name); return mocks[name]; }, crypto, Date, Error, Response, console, ...extras });
  return exports;
}

for (const expired of [false, true]) it(`recovers interrupted jobs, isolates errors, and handles exhaustion: ${expired}`, async () => {
  const updates: string[] = [];
  const jobs = ["one", "two"].map((id) => ({ id, customerId: id, consentId: id, attemptCount: 1, expiresAt: expired ? "2000-01-01" : "2099-01-01", claimToken: "claim" }));
  let syncs = 0;
  let queuedAlerts = 0;
  const worker = load("lib/onboarding/subscription-activation-jobs.ts", {
    "server-only": {}, "drizzle-orm": { sql },
    "@/lib/db": { getDb: () => ({ execute: async (statement: Parameters<PgDialect["sqlToQuery"]>[0]) => {
      const { sql: query, params } = new PgDialect().sqlToQuery(statement); updates.push(query);
      if (query.includes("with candidates")) { assert.match(query, /status = 'processing' and claimed_at/); assert.match(query, /skip locked/); return { rows: jobs }; }
      if (query.includes('as "mollieId"')) return { rows: [{ mollieId: "pl_1" }] };
      if (query.includes("status = 'retrying'")) assert.ok(params.includes("temporary failure"));
      return { rows: [] };
    } }) },
    "@/lib/reliability/sync": { syncPaymentLinkByMollieId: async (_: string, options: { reconciliationMode: string }) => { assert.equal(options.reconciliationMode, "sync_only"); if (++syncs === 1) throw new Error("temporary failure"); } },
    "@/lib/onboarding/subscription-activation": { attemptSubscriptionActivation: async (input: { consentId: string }) => { assert.equal(input.consentId, "two"); return { status: "created", subscriptionId: "sub-2" }; } },
    "@/lib/onboarding/subscription-activation-notifications": { queueSubscriptionActivationExhaustedNotifications: async () => { queuedAlerts++; } },
    "@/lib/reliability/alerts": { openAlert: async () => ({ isNew: true }) },
    "@/lib/audit": { writeAuditLog: async () => {} },
    "@/lib/onboarding/subscription-activation-retry-policy": { ACTIVATION_RECOVERY_WINDOW_MS: 86400000, getSubscriptionActivationRetryDelay: () => 300000 },
  });
  const result = await worker.processSubscriptionActivationJobsBatch({ tenantId: "tenant", mode: "live", limit: 2 } as never) as { retriedCount: number; activatedCount: number };
  assert.equal(result.retriedCount, expired ? 0 : 1); assert.equal(result.activatedCount, 1);
  assert.equal(queuedAlerts, expired ? 1 : 0);
  assert.ok(updates.some((query) => query.includes("claim_token =") && query.includes(expired ? "status = 'exhausted'" : "status = 'retrying'")));
});

for (const trigger of [null, "workflow_dispatch", "schedule"]) it(`onboarding endpoint authorization and trigger: ${trigger}`, async () => {
  const authorized = trigger !== null;
  const calls: string[] = [];
  const worker = load("app/api/cron/onboarding/route.ts", {
    "drizzle-orm": { sql }, "@/lib/db": { getDb: () => ({ execute: async () => ({ rows: [{ count: 0 }] }) }) },
    "@/lib/cron-auth": { isBearerAuthorized: (header: string, keys: string[]) => header === `Bearer ${keys[0]}` },
    "@/lib/tenants": { listTenants: async () => { calls.push("tenants"); return [{ id: "tenant" }]; } },
    "@/lib/onboarding/subscription-activation-jobs": { discoverPendingOnboardingPayments: async () => ({ failedCount: 0 }), processSubscriptionActivationJobsBatch: async () => ({ activatedCount: 1 }) },
    "@/lib/onboarding/subscription-activation-notifications": { deliverSubscriptionActivationNotificationsBatch: async () => ({ failedCount: 0 }) },
    "@/lib/audit": { writeAuditLog: async (entry: { details: { trigger: string } }) => { assert.equal(entry.details.trigger, trigger === "schedule" ? "schedule" : "manual_or_external"); calls.push("audit"); } },
  }, { process: { env: { ONBOARDING_RECOVERY_SECRET: "test-secret" } } });
  const response = await worker.POST(new Request("https://kify.app/api/cron/onboarding", { method: "POST", headers: authorized ? { Authorization: "Bearer test-secret", "X-Kify-Recovery-Trigger": trigger! } : {} }) as never) as Response;
  assert.equal(response.status, authorized ? 200 : 401); assert.equal(calls.length, authorized ? 2 : 0);
});
