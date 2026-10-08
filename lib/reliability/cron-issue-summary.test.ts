import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { collectCronIssues, sendCronIssueSummary, type CronIssue } from "./cron-issue-summary";

function cleanResult() {
  const creation = { actionableCount: 0, createdCount: 0, failedCount: 0, remainingActionableCount: 0, skippedCount: 0 };
  const recovery = { ambiguousCount: 0, verificationFailedCount: 0, recoveredCount: 0, scannedCount: 0 };
  const delivery = { attemptedCount: 0, failedCount: 0, sentCount: 0, skippedCount: 0 };
  return {
    tenantId: "tenant-1", tenantName: "Ayal Web", tenantSlug: "ayal", mode: "live",
    paymentDiscovery: { failedCount: 0, repairedCount: 2 },
    webhookRepairResult: { failedCount: 0, repairedCount: 0, skippedCount: 0, totalChecked: 0 },
    staleRepairResult: { failedCount: 0, repairedCount: 2, skippedCount: 1, totalChecked: 3, customersChecked: 1, paymentsChecked: 2, subscriptionsChecked: 0 },
    activationJobs: { exhaustedCount: 0, retriedCount: 0 },
    activationNotifications: { failedCount: 0 },
    firstPaymentCreateResult: { ...creation }, recurringCreateResult: { ...creation },
    firstPaymentDeliveryRetry: { ...delivery }, recurringDeliveryRetry: { ...delivery },
    failedFirstPaymentRecoveryResult: { ...recovery }, failedRecurringRecoveryResult: { ...recovery },
    safeFailedFirstPaymentRetryQueue: { queuedCount: 0, skippedCount: 0 },
    safeFailedRecurringRetryQueue: { queuedCount: 0, skippedCount: 0 },
  };
}

it("keeps successful repairs, empty checks and harmless skips quiet", () => {
  assert.deepEqual(collectCronIssues(cleanResult()), []);
});

it("covers each failing cron stage, even when other targets succeeded", () => {
  const result = cleanResult();
  for (const stage of [result.paymentDiscovery, result.webhookRepairResult, result.staleRepairResult,
    result.activationNotifications, result.firstPaymentCreateResult, result.recurringCreateResult,
    result.firstPaymentDeliveryRetry, result.recurringDeliveryRetry]) stage.failedCount = 1;
  result.firstPaymentCreateResult.createdCount = 3;
  result.activationJobs.exhaustedCount = 1;
  result.activationJobs.retriedCount = 1;
  result.failedFirstPaymentRecoveryResult.ambiguousCount = 1;
  result.failedFirstPaymentRecoveryResult.verificationFailedCount = 1;
  result.failedRecurringRecoveryResult.ambiguousCount = 1;
  result.failedRecurringRecoveryResult.verificationFailedCount = 1;
  const issues = collectCronIssues(result);
  assert.equal(issues.length, 14);
  assert.ok(issues.every((issue) => issue.tenantId === "tenant-1" && issue.count === 1));
});

const notification = {
  appUrl: "https://kify.app", mode: "live" as const, runId: "run-1",
  issues: [{ tenantId: "tenant-1", tenantName: "Ayal Web", stage: "Webhook repair failed", count: 2 }],
};

it("sends one summary, not one email per issue, without raw failure data", async () => {
  const messages: { subject: string; text: string }[] = [];
  const records: string[] = [];
  const result = await sendCronIssueSummary({ ...notification, issues: [...notification.issues, ...notification.issues] }, {
    send: async (message) => { messages.push(message); },
    record: async (outcome) => { records.push(outcome); },
    reportFailure: () => assert.fail("unexpected failure"),
  });
  assert.equal(result, "sent");
  assert.equal(messages.length, 1);
  assert.match(messages[0].subject, /LIVE/);
  assert.match(messages[0].text, /https:\/\/kify.app\/settings/);
  assert.match(messages[0].text, /run-1/);
  assert.deepEqual(records, ["success"]);
});

it("does not send or audit a healthy run", async () => {
  assert.equal(await sendCronIssueSummary({ ...notification, issues: [] }, {
    send: async () => assert.fail("healthy run must not email"),
    record: async () => assert.fail("healthy run must not audit delivery"),
    reportFailure: () => assert.fail("healthy run must not report failure"),
  }), "skipped");
});

it("contains SMTP and audit failures without retries or recursive alerts", async () => {
  let attempts = 0;
  let logged = 0;
  const outcomes: string[] = [];
  assert.equal(await sendCronIssueSummary(notification, {
    send: async () => { attempts++; throw new Error("secret SMTP credential"); },
    record: async (outcome) => { outcomes.push(outcome); throw new Error("DB unavailable"); },
    reportFailure: () => { logged++; },
  }), "failed");
  assert.equal(attempts, 1);
  assert.equal(logged, 1);
  assert.deepEqual(outcomes, ["failure"]);
});

it("does not mark an already sent email as unsent if the audit fails", async () => {
  const records: string[] = [];
  assert.equal(await sendCronIssueSummary(notification, {
    send: async () => {},
    record: async (outcome) => { records.push(outcome); throw new Error("DB unavailable"); },
    reportFailure: () => {},
  }), "sent_audit_failed");
  assert.deepEqual(records, ["success"]);
});

// Exercise the real route handler, with no database, SMTP or provider imports.
async function exerciseRoute(options: { authorized?: boolean; listFails?: boolean; tenantFails?: boolean; stageFails?: boolean; empty?: boolean; notifyFails?: boolean; actualStages?: boolean; secondTenant?: boolean; auditFails?: boolean; revalidationFails?: boolean }) {
  const path = "app/api/cron/recurring-invoices/route.ts";
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
  const names = ["POST", "emptyTenantCronResult", ...(options.actualStages ? ["runTenantCronBatch"] : [])];
  const declarations = source.statements.filter((node) => ts.isFunctionDeclaration(node) && names.includes(node.name?.text ?? ""));
  const exports: { POST?: (request: Request) => Promise<Response> } = {};
  const notifications: { issues: CronIssue[] }[] = [];
  const stages: string[] = [];
  const audits: { outcome: string; details: unknown }[] = [];
  const stageNames = {
    discoverRecurringPaymentsBatch: "paymentDiscovery", repairWebhookEventsBatch: "webhookRepairResult",
    repairStaleRecordsBatch: "staleRepairResult", processSubscriptionActivationJobsBatch: "activationJobs",
    queueRetryForSafeFailedRecurringInvoicesBatch: "safeFailedRecurringRetryQueue",
    queueRetryForSafeFailedFirstPaymentInvoicesBatch: "safeFailedFirstPaymentRetryQueue",
    recoverFailedRecurringInvoicesBatch: "failedRecurringRecoveryResult",
    recoverFailedFirstPaymentInvoicesBatch: "failedFirstPaymentRecoveryResult",
    createDueRecurringInvoicesBatch: "recurringCreateResult", createDueFirstPaymentInvoicesBatch: "firstPaymentCreateResult",
    retryUnsentRecurringInvoiceEmailsBatch: "recurringDeliveryRetry", retryUnsentFirstPaymentInvoiceEmailsBatch: "firstPaymentDeliveryRetry",
    deliverSubscriptionActivationNotificationsBatch: "activationNotifications",
  } as const;
  const stageDependencies = Object.fromEntries(Object.entries(stageNames).map(([fn, key]) => [fn, async (context: { tenantId: string; mode: string }) => {
    assert.ok(["tenant-1", "tenant-2"].includes(context.tenantId));
    assert.equal(context.mode, "live");
    stages.push(`${context.tenantId}:${key}`);
    if (context.tenantId === "tenant-1" && key === "firstPaymentCreateResult") throw new Error("private provider failure");
    if (key === "recurringCreateResult") {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { ...cleanResult()[key], createdCount: 2 };
    }
    return cleanResult()[key];
  }]));
  runInNewContext(ts.transpileModule(declarations.map((node) => node.getText(source)).join("\n"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports, Response, Error, crypto, console: { error: () => {} }, ...stageDependencies,
    isAuthorized: () => options.authorized ?? true,
    parseMode: () => "live", parseLimit: () => 25,
    listTenants: async () => {
      if (options.listFails) throw new Error("postgres://private-credential");
      return options.empty ? [] : [{ id: "tenant-1", name: "Ayal Web", slug: "ayal" }, ...(options.secondTenant ? [{ id: "tenant-2", name: "Second", slug: "second" }] : [])];
    },
    runTenantCronBatch: async () => {
      if (options.tenantFails) throw new Error("secret provider response");
      const result = cleanResult();
      if (options.stageFails) result.staleRepairResult.failedCount = 1;
      return result;
    },
    collectCronIssues, writeAuditLog: async (entry: (typeof audits)[number]) => {
      if (options.auditFails) throw new Error("DB unavailable");
      audits.push(entry);
    }, revalidatePath: () => { if (options.revalidationFails) throw new Error("cache unavailable"); },
    notifyCronIssues: async (input: { issues: CronIssue[] }) => { notifications.push(input); if (options.notifyFails) throw new Error("SMTP unavailable"); },
  });
  assert.ok(exports.POST);
  const response = await exports.POST(new Request("https://kify.app/api/cron/recurring-invoices"));
  return { response, notifications, stages, audits };
}

it("does not allow unauthenticated requests to generate emails", async () => {
  const { response, notifications } = await exerciseRoute({ authorized: false });
  assert.equal(response.status, 401);
  assert.equal(notifications.length, 0);
});

for (const options of [{ listFails: true }, { tenantFails: true }, { stageFails: true }]) {
  it(`awaits one safe summary for ${Object.keys(options)[0]}`, async () => {
    const { response, notifications } = await exerciseRoute(options);
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].issues.length, 1);
    assert.doesNotMatch(JSON.stringify(notifications), /private-credential|secret provider response/);
    if (!options.listFails) assert.equal((await response.json()).status, "partial");
  });
}

it("treats no tenants as a successful no-op", async () => {
  const { response, notifications } = await exerciseRoute({ empty: true });
  assert.equal((await response.json()).status, "ok");
  assert.equal(notifications[0].issues.length, 0);
});

it("retains completed billing, waits for a concurrent sibling and continues the next tenant", async () => {
  const { response, notifications, stages, audits } = await exerciseRoute({ actualStages: true, secondTenant: true });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, "partial");
  assert.equal(body.aggregate.recurringCreateResult.createdCount, 4);
  assert.equal(body.tenantResults[0].recurringCreateResult.createdCount, 2);
  assert.ok(body.tenantResults[0].completedStages.includes("recurringCreateResult"));
  assert.deepEqual(body.tenantResults[0].failedStages, ["firstPaymentCreateResult"]);
  assert.ok(!stages.includes("tenant-1:recurringDeliveryRetry"));
  assert.ok(stages.includes("tenant-2:activationNotifications"));
  assert.deepEqual(audits.map((entry) => entry.outcome), ["failure", "success"]);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].issues.length, 1);
  assert.doesNotMatch(JSON.stringify(body), /private provider failure/);
  assert.equal(body.tenantResults[0].runId, body.runId);
});

for (const extra of [{ notifyFails: true }, { auditFails: true }, { revalidationFails: true }]) {
  it(`does not turn completed billing into HTTP failure on ${Object.keys(extra)[0]}`, async () => {
    const { response, stages } = await exerciseRoute({ actualStages: true, secondTenant: true, ...extra });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).aggregate.recurringCreateResult.createdCount, 4);
    assert.equal(stages.filter((stage) => stage.endsWith(":recurringCreateResult")).length, 2);
  });
}
