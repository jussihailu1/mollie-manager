import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

import { createInvoiceBatchWithDependencies } from "./invoice-creation-batch";
import { recoverTargetsIndependently } from "./reliability/isolated-recovery";

// Execute the actual orchestration functions with inert dependencies, without
// importing server modules that can connect to databases or payment providers.
function loadFunction(path: string, name: string, dependencies: Record<string, unknown>) {
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
  const declaration = source.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === name,
  );
  assert.ok(declaration, `${name} must exist in ${path}`);
  const { outputText } = ts.transpileModule(declaration.getText(source), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const exports: Record<string, (input: unknown) => Promise<Record<string, number>>> = {};
  runInNewContext(outputText, { ...dependencies, Error, exports });
  return exports[name];
}

const firstPaymentPath = "lib/eboekhouden/first-payment-invoices.ts";
const input = { actor: { kind: "system" as const }, mode: "test" as const, tenantId: "active-kify-tenant" };

it("counts mixed invoice outcomes and contains an issuer exception without retrying", async () => {
  const attempts: string[] = [];
  const result = await createInvoiceBatchWithDependencies(input, {
    loadCandidates: async () => ["created", "throws", "failed", "skipped", "created-again"].map((entityId) => ({ entityId })),
    createInvoice: async (id) => {
      attempts.push(id);
      if (id === "throws") throw new Error("uncertain provider acceptance");
      return { status: id.startsWith("created") ? "created" : id === "failed" ? "failed" : "skipped" };
    },
    getRemainingSummary: async () => ({ actionableCount: 1 }),
  });
  assert.deepEqual(result, { actionableCount: 5, createdCount: 2, failedCount: 2, skippedCount: 1, remainingActionableCount: 1 });
  assert.deepEqual(attempts, ["created", "throws", "failed", "skipped", "created-again"]);
});

function firstPaymentBatch(options: {
  provider: "kify" | "mollie" | "eboekhouden";
  candidate?: boolean;
  validationOk?: boolean;
  complete?: boolean;
  issuerFails?: boolean;
}) {
  const calls: string[] = [];
  const settings = { activeInvoiceProvider: options.provider };
  const getTenantBillingSettings = async (tenantId: string) => {
    assert.equal(tenantId, input.tenantId);
    return settings;
  };
  const getInvoiceProviderAdapterById = (provider: string) => {
    calls.push(`adapter:${provider}`);
    assert.notEqual(provider, "kify", "Kify must never resolve a legacy adapter");
    return {
      validateTenantSetup: async (context: { tenantId: string; mode: string }) => {
        assert.equal(context.tenantId, input.tenantId);
        assert.equal(context.mode, input.mode);
        return { ok: options.validationOk ?? true, reason: "Provider setup invalid" };
      },
    };
  };
  const createInvoiceForFirstPayment = loadFunction(firstPaymentPath, "createInvoiceForFirstPayment", {
    getTenantBillingSettings,
    getInvoiceProviderAdapterById,
    getFirstPaymentInvoiceCandidate: async (paymentId: string, tenantId: string) => {
      assert.equal(paymentId, "payment-1");
      assert.equal(tenantId, input.tenantId);
      return {
        paymentId, tenantId, customerId: "customer-1", mode: input.mode,
        consentAcceptedAt: "2026-10-01", firstPaymentMode: "real_installment",
        amountValue: "12.10", planSnapshot: { description: "Subscription" },
      };
    },
    resolveFirstPaymentInvoiceDate: () => "2026-10-01",
    subscriptionConsentPlanSnapshotSchema: {
      safeParse: (data: unknown) => ({ success: true, data }),
    },
    issueKifyInvoice: async (context: { tenantId: string; ownerId: string; mode: string }) => {
      assert.equal(context.tenantId, input.tenantId);
      assert.equal(context.ownerId, "payment-1");
      assert.equal(context.mode, input.mode);
      calls.push("kify-issuer");
      if (options.issuerFails) throw new Error("Kify invoice profile incomplete");
      return { status: "created", invoiceId: "invoice-1", invoiceNumber: "TEST-1" };
    },
  });
  const batch = loadFunction(firstPaymentPath, "createDueFirstPaymentInvoicesBatch", {
    getTenantBillingSettings,
    getInvoiceProviderAdapterById,
    billingSettingsAreComplete: () => {
      calls.push("legacy-settings");
      return options.complete ?? true;
    },
    normalizeFirstPaymentInvoiceStatesImpl: async (context: { tenantId: string }) => {
      assert.equal(context.tenantId, input.tenantId);
      calls.push("normalize");
    },
    createInvoiceBatchWithDependencies,
    createInvoiceForFirstPayment,
    getDueFirstPaymentInvoiceQueueSummary: async (mode: string, tenantId: string) => {
      assert.equal(mode, input.mode);
      assert.equal(tenantId, input.tenantId);
      return { actionableCount: 0 };
    },
    listDueFirstPaymentInvoiceCandidates: async (mode: string, limit: number, tenantId: string) => {
      assert.equal(mode, input.mode);
      assert.equal(tenantId, input.tenantId);
      assert.equal(limit, 25);
      return options.candidate ? [{ paymentId: "payment-1" }] : [];
    },
  });
  return { batch, calls };
}

describe("first-payment cron provider routing", () => {
  it("runs an empty active Kify tenant without a legacy adapter or settings", async () => {
    const { batch, calls } = firstPaymentBatch({ provider: "kify", complete: false });
    const result = await batch(input);
    assert.equal(result.createdCount, 0);
    assert.equal(result.failedCount, 0);
    assert.deepEqual(calls, ["normalize"]);
  });

  it("routes a due first payment through the tenant-scoped Kify issuer", async () => {
    const { batch, calls } = firstPaymentBatch({ provider: "kify", candidate: true });
    assert.equal((await batch(input)).createdCount, 1);
    assert.deepEqual(calls, ["normalize", "kify-issuer"]);
  });

  it("does not bypass a Kify issuer failure or fall back to a legacy provider", async () => {
    const { batch, calls } = firstPaymentBatch({ provider: "kify", candidate: true, issuerFails: true });
    assert.equal((await batch(input)).failedCount, 1);
    assert.deepEqual(calls, ["normalize", "kify-issuer"]);
  });

  for (const provider of ["mollie", "eboekhouden"] as const) {
    it(`still validates ${provider} setup before even an empty batch`, async () => {
      const { batch, calls } = firstPaymentBatch({ provider, validationOk: false });
      await assert.rejects(batch(input), /Provider setup invalid/);
      assert.deepEqual(calls, [`adapter:${provider}`]);
    });

    it(`still requires complete ${provider} billing settings`, async () => {
      const { batch, calls } = firstPaymentBatch({ provider, complete: false });
      await assert.rejects(batch(input), /Provider setup invalid/);
      assert.deepEqual(calls, [`adapter:${provider}`, "legacy-settings"]);
    });

    it(`allows a validated ${provider} batch`, async () => {
      const { batch, calls } = firstPaymentBatch({ provider });
      assert.equal((await batch(input)).failedCount, 0);
      assert.deepEqual(calls, [`adapter:${provider}`, "legacy-settings", "normalize"]);
    });
  }
});

describe("repair batch audit outcomes", () => {
  for (const kind of ["webhook", "stale"] as const) {
    for (const statuses of [[], ["repaired"], ["failed"], ["failed", "repaired"], ["skipped"]]) {
      it(`${kind}: ${statuses.join(", ") || "empty"} reports failures truthfully`, async () => {
        const audits: { action: string; outcome: string; entityId: string }[] = [];
        const candidates = statuses.map((status, index) => ({
          id: String(index), status, mode: input.mode, priority: 1, lastSyncedAt: null,
          resourceId: status === "skipped" ? null : `tr_${index}`,
        }));
        const batch = loadFunction("lib/reliability/repair.ts", kind === "webhook" ? "repairWebhookEventsBatch" : "repairStaleRecordsBatch", {
          normalizeLimit: (limit: number) => limit,
          toMillis: () => 0,
          recoverTargetsIndependently,
          listFailedWebhookCandidatesForTenant: async () => candidates,
          listCustomerCandidates: async () => candidates,
          listPaymentCandidates: async () => [],
          listSubscriptionCandidates: async () => [],
          processWebhookResource: async (resourceId: string, mode: string, actor: unknown, tenantId: string) => {
            assert.equal(tenantId, input.tenantId);
            assert.equal(mode, input.mode);
            if (statuses[Number(resourceId.slice(3))] === "failed") throw new Error("Provider unavailable");
          },
          updateWebhookEventStatus: async (context: { tenantId: string }) => {
            assert.equal(context.tenantId, input.tenantId);
          },
          repairCustomerTarget: async (context: { customerId: string; tenantId: string }) => {
            assert.equal(context.tenantId, input.tenantId);
            const status = statuses[Number(context.customerId)];
            if (status === "failed") throw new Error("Provider unavailable");
            return { id: context.customerId, status };
          },
          writeAuditLog: async (entry: (typeof audits)[number]) => { audits.push(entry); },
        });
        const result = await batch({ ...input, limit: 25 });
        // A failed webhook without a resource is still unresolved; a stale
        // record deliberately skipped by its target repair is not an exception.
        const expectedFailures = statuses.filter((status) => status === "failed" || (kind === "webhook" && status === "skipped")).length;
        assert.equal(result.failedCount, expectedFailures);
        assert.equal(result.repairedCount, statuses.filter((status) => status === "repaired").length);
        assert.equal(result.totalChecked, statuses.length);
        const batchAudit = audits.at(-1);
        assert.equal(batchAudit?.action, `repair.${kind}_batch`);
        assert.equal(batchAudit?.entityId, input.tenantId);
        assert.equal(batchAudit?.outcome, expectedFailures ? "failure" : "success");
        if (kind === "stale") assert.equal(audits.length, expectedFailures + 1);
      });
    }
  }
});
