import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { loadIsolated } from "@/lib/testing/isolated-module";
import * as flow from "@/lib/eboekhouden/invoice-flow-helpers";
import * as posting from "@/lib/eboekhouden/invoice-posting";
import * as pagination from "@/lib/eboekhouden/pagination";
import * as validation from "@/lib/eboekhouden/invoice-total-validation";
import * as tax from "@/lib/invoicing/tax-treatment";
import { buildInvoiceCreationFailureMetadata } from "@/lib/eboekhouden/invoice-creation-metadata";
import { filterSafeFailedInvoiceRetryIds } from "@/lib/eboekhouden/invoice-retry-candidates";
import type { EboekhoudenInvoice } from "@/lib/eboekhouden/client";

// Run the actual batch orchestration without importing app runtime side effects.
// Its source is extracted, not copied; provider, persistence and mail boundaries
// below are isolated. No environment files, network or real database are used.
function loadFunction<T>(file: string, name: string, dependencies: Record<string, unknown>): T {
  const ast = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const declaration = ast.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === name);
  assert.ok(declaration, name);
  const exports = {};
  const code = ts.transpileModule(declaration.getText(ast), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(code, { exports, Date, Error, ...dependencies });
  return exports as T;
}

const ledgers = [{ id: 10, category: "DEB" }, { id: 20, category: "VW" }];
const invoice: EboekhoudenInvoice = {
  id: 42, invoiceNumber: "F-fixture", relationId: 5, reference: "RB-frozen", date: "2026-06-01",
  inExVat: "IN", totalAmount: 19.99, totalExcl: 19.99, vatAmount: 0,
  items: [{ quantity: 1, pricePerUnit: 19.99, vatCode: "GEEN", ledgerId: 20, description: "Fixture" }],
};
const sale: posting.SalesMutation = {
  id: 99, type: 2, date: invoice.date!, invoiceNumber: invoice.invoiceNumber!, relationId: 5,
  ledgerId: 10, inExVat: "IN", rows: [{ ledgerId: 20, amount: 19.99, vatCode: "GEEN" }],
};
const candidate = {
  amountValue: "19.99", eboekhoudenRelationId: 5, tenantId: "fixture", mode: "live" as const,
  scheduleId: "schedule-fixture", paymentId: "payment-fixture", customerId: "customer-fixture", customerEmail: "fixture@example.test",
  subscriptionId: "subscription-fixture", plannedCollectionDate: "2026-10-01", invoiceSendDueDate: "2026-09-26",
  paidAt: "2026-09-26", paymentCreatedAt: "2026-09-26", taxTreatment: "kor" as const,
  expectedInvoiceDate: "2026-06-01", expectedInvoiceReference: "RB-frozen",
  planSnapshot: { description: "Fixture" }, subscriptionDescription: "Fixture",
};

function verification(document: EboekhoudenInvoice, sales: posting.SalesMutation[], failRead = false) {
  let postingReads = 0;
  const postingVerifier = loadIsolated<typeof import("@/lib/eboekhouden/invoice-posting-verification")>("lib/eboekhouden/invoice-posting-verification.ts", {
    "@/lib/eboekhouden/client": {
      listEboekhoudenSalesMutations: async (input: { tenantId: string; invoiceNumber: string }) => {
        postingReads++;
        assert.equal(input.tenantId, "fixture"); assert.equal(input.invoiceNumber, document.invoiceNumber);
        if (failRead) throw new Error("Posting read unavailable");
        return { items: sales };
      },
      getEboekhoudenMutation: async (id: number, tenant: string) => { assert.equal(tenant, "fixture"); return sales.find(item => item.id === id)!; },
      listEboekhoudenLedgers: async () => ({ items: ledgers }),
    },
    "@/lib/eboekhouden/invoice-posting": posting,
    "@/lib/eboekhouden/pagination": pagination,
  });
  const verifier = loadIsolated<typeof import("@/lib/eboekhouden/invoice-total-verification")>("lib/eboekhouden/invoice-total-verification.ts", {
    "@/lib/eboekhouden/client": { getEboekhoudenInvoice: async (id: number, tenant: string) => {
      assert.equal(id, document.id); assert.equal(tenant, "fixture"); return document;
    } },
    "@/lib/eboekhouden/invoice-total-validation": validation,
    "@/lib/invoicing/tax-treatment": tax,
    "@/lib/eboekhouden/invoice-posting-verification": postingVerifier,
  });
  return { verifier, reads: () => postingReads };
}

for (const kind of ["recurring", "first-payment"] as const) describe(`${kind} scheduled recovery posting gate`, () => {
  async function recover(sales: posting.SalesMutation[], document = invoice, failRead = false) {
    const checks = verification(document, sales, failRead);
    let stored = 0, delivered = 0, held = 0;
    const store = async () => { stored++; return { invoiceId: "42", invoiceNumber: invoice.invoiceNumber }; };
    const dependencies = {
      DEFAULT_BATCH_SIZE: 25, resolveTenantId: async () => "fixture", getTenantActiveInvoiceProvider: async () => "eboekhouden",
      recoverStaleInvoiceClaims: async () => {}, getTenantBillingSettings: async () => ({ taxTreatment: "standard", activeInvoiceProvider: "eboekhouden" }),
      listFailedRecurringRecoveryCandidates: async () => [candidate], listFailedFirstPaymentRecoveryCandidates: async () => [candidate],
      buildRecurringInvoiceReference: () => "changed-reference", buildFirstPaymentInvoiceReference: () => "changed-reference",
      resolveFirstPaymentInvoiceDate: () => "2026-09-26",
      findExistingEboekhoudenInvoiceByReference: async (input: { date: string; reference: string }) => {
        assert.equal(input.date, "2026-06-01"); assert.equal(input.reference, "RB-frozen");
        return { status: "found", invoice };
      },
      requireTaxTreatment: tax.requireTaxTreatment, verifiedEboekhoudenInvoice: checks.verifier.verifiedEboekhoudenInvoice,
      storeRecoveredFailedInvoiceSuccess: store, storeRecoveredFailedFirstPaymentSuccess: store,
      deliverCustomerInvoiceEmail: async () => { assert.equal(stored, 1); delivered++; }, buildFirstPaymentInvoiceDelivery: (value: unknown) => value,
      recordFailedEboekhoudenInvoiceReview: async () => { held++; },
    };
    const name = kind === "recurring" ? "recoverFailedRecurringInvoicesBatch" : "recoverFailedFirstPaymentInvoicesBatch";
    type Batch = (input: unknown) => Promise<{ recoveredCount: number; verificationFailedCount: number }>;
    const runtime = loadFunction<Record<string, Batch>>(`lib/eboekhouden/${kind === "recurring" ? "recurring" : "first-payment"}-invoices.ts`, name, dependencies);
    const result = await runtime[name]({ tenantId: "fixture", mode: "live", actor: { kind: "system" } });
    return { result, stored, delivered, held, postingReads: checks.reads() };
  }
  it("keeps missing, duplicate, mismatched and unreadable postings on hold without storing or sending", async () => {
    for (const [sales, failRead] of [[[], false], [[sale, { ...sale, id: 100 }], false], [[{ ...sale, ledgerId: 20 }], false], [[sale], true]] as const) {
      const result = await recover([...sales], invoice, failRead);
      assert.equal(result.postingReads, 1);
      assert.equal(result.result.recoveredCount, 0); assert.equal(result.result.verificationFailedCount, 1);
      assert.equal(result.stored, 0); assert.equal(result.delivered, 0); assert.equal(result.held, 1);
    }
  });
  it("recovers a correct sale using the frozen date, reference and tax treatment", async () => {
    const result = await recover([sale]);
    assert.equal(result.postingReads, 1); assert.equal(result.result.recoveredCount, 1);
    assert.equal(result.stored, 1); assert.equal(result.delivered, 1); assert.equal(result.held, 0);
  });
  it("rejects a provider document and sale that agree on a changed date", async () => {
    const result = await recover([{ ...sale, date: "2026-09-26" }], { ...invoice, date: "2026-09-26" });
    assert.equal(result.result.recoveredCount, 0); assert.equal(result.held, 1);
    assert.equal(result.stored, 0); assert.equal(result.delivered, 0);
  });
});

type Failure = "ledger503" | "ledger429" | "network" | "session503" | "ledger403" | "mapping" | "postTimeout" | "post503" | "post401Refresh503" | "post401RetryTimeout";
for (const kind of ["recurring", "first-payment"] as const) describe(`${kind} actual client preflight and retry`, () => {
  async function scenario(initialFailure: Failure) {
    let failing = true, financialPosts = 0, stored = 0, delivered = 0;
    let state = "pending_invoice";
    let failure: ReturnType<typeof buildInvoiceCreationFailureMetadata> | undefined;
    const client = loadIsolated<typeof import("@/lib/eboekhouden/client")>("lib/eboekhouden/client.ts", {
      "server-only": {}, zod: { ZodError: class extends Error {} },
      "@/lib/eboekhouden/tenant-credentials": { TenantEboekhoudenCredentialError: class extends Error {},
        resolveTenantEboekhoudenConfig: async () => ({ EBOEKHOUDEN_API_TOKEN: "fixture", EBOEKHOUDEN_API_SOURCE: "fixture" }) },
      "@/lib/eboekhouden/invoice-posting": posting, "@/lib/eboekhouden/pagination": pagination,
      "@/lib/eboekhouden/invoice-flow-helpers": flow,
    }, { fetch: async (url: string, init: RequestInit) => {
      const path = new URL(url).pathname;
      if (path === "/v1/session") return failing && (initialFailure === "session503" || (initialFailure === "post401Refresh503" && financialPosts > 0))
        ? Response.json({ message: "Unavailable" }, { status: 503 }) : Response.json({ token: "fixture", expiresIn: 60 });
      if (path === "/v1/ledger") {
        if (failing && initialFailure === "network") throw new TypeError("fetch failed");
        const status = initialFailure === "ledger503" ? 503 : initialFailure === "ledger429" ? 429 : initialFailure === "ledger403" ? 403 : 200;
        if (failing && status !== 200) return Response.json({ message: "Ledger read failed" }, { status });
        return Response.json({ items: failing && initialFailure === "mapping" ? [] : ledgers });
      }
      assert.equal(path, "/v1/invoice"); assert.equal(init.method, "POST");
      financialPosts++;
      if (failing && (initialFailure === "post401Refresh503" || initialFailure === "post401RetryTimeout")) {
        if (financialPosts === 1) return Response.json({ message: "Expired session" }, { status: 401 });
        throw new TypeError("fetch failed");
      }
      if (failing && initialFailure === "postTimeout") throw new TypeError("fetch failed");
      if (failing && initialFailure === "post503") return Response.json({ message: "Unavailable" }, { status: 503 });
      const body = JSON.parse(String(init.body));
      assert.equal(body.date, "2026-06-01"); assert.equal(body.reference, "RB-frozen");
      return Response.json({ id: 42, invoiceNumber: invoice.invoiceNumber });
    } });
    const checks = verification(invoice, [sale]);
    const claim = async () => { if (state !== "pending_invoice") return null; state = "invoice_creating"; return "claimed"; };
    const success = async () => { stored++; state = "invoice_created"; return { invoiceId: "42", invoiceNumber: invoice.invoiceNumber }; };
    const fail = async (input: Parameters<typeof buildInvoiceCreationFailureMetadata>[0] & { error: Error }) => {
      state = "invoice_failed"; failure = buildInvoiceCreationFailureMetadata({ ...input, errorMessage: input.error.message });
      return kind === "recurring" ? input.error.message : { errorMessage: input.error.message };
    };
    const runtime = loadIsolated<Record<string, (id: string, options: { tenantId: string }) => Promise<{ status: string }>>>(`lib/eboekhouden/${kind}-invoice-workflow.ts`, {
      "@/lib/billing-settings": { billingSettingsAreComplete: () => true, getTenantBillingSettings: async () => ({ taxTreatment: "kor", invoiceTemplateId: 1, revenueLedgerId: 20 }) },
      "@/lib/eboekhouden/client": client, "@/lib/eboekhouden/invoice-total-verification": checks.verifier,
      "@/lib/eboekhouden/invoice-flow-helpers": flow,
      "@/lib/eboekhouden/invoice-reference": { buildRecurringInvoiceReference: () => "changed-reference", buildFirstPaymentInvoiceReference: () => "changed-reference" },
      "@/lib/eboekhouden/recurring-invoice-candidate": { getScheduledInvoiceCandidate: async () => candidate },
      "@/lib/eboekhouden/first-payment-invoice-candidate": { getFirstPaymentInvoiceCandidate: async () => candidate },
      "@/lib/eboekhouden/first-payment-invoice-eligibility": { describeFirstPaymentInvoiceEligibility: () => ({ status: "eligible", candidate }) },
      "@/lib/eboekhouden/first-payment-invoice-date": { resolveFirstPaymentInvoiceDate: () => "2026-09-26" },
      "@/lib/eboekhouden/first-payment-invoice-delivery": { buildFirstPaymentInvoiceDelivery: (value: unknown) => value },
      "@/lib/subscription-consent": { subscriptionConsentPlanSnapshotSchema: { safeParse: () => ({ success: true, data: candidate.planSnapshot }) } },
      "@/lib/eboekhouden/recurring-invoice-persistence": { claimScheduleForInvoice: claim, storeRecurringInvoiceCreationSuccess: success, storeRecurringInvoiceCreationFailure: fail },
      "@/lib/eboekhouden/first-payment-invoice-persistence": { claimFirstPaymentInvoiceForCreation: claim, storeFirstPaymentInvoiceCreationSuccess: success, storeFirstPaymentInvoiceCreationFailure: fail },
      "@/lib/eboekhouden/invoice-reconcile": { findExistingEboekhoudenInvoiceByReference: async () => ({ status: "none" }) },
      "@/lib/invoice-delivery": { deliverCustomerInvoiceEmail: async () => { delivered++; } },
      "@/lib/invoicing/tax-treatment": tax,
    });
    const run = () => runtime[kind === "recurring" ? "createEboekhoudenInvoiceForSchedule" : "createEboekhoudenInvoiceForFirstPayment"]("fixture", { tenantId: "fixture" });
    assert.equal((await run()).status, "failed");
    assert.ok(failure);
    const safe = filterSafeFailedInvoiceRetryIds([{ id: "fixture", errorMessage: failure.invoiceCreationError, manualReview: failure.invoiceCreationManualReview }]);
    const firstAttempt = { failure, financialPosts, stored, delivered, safe };
    if (safe.length) {
      failing = false; state = "pending_invoice";
      assert.equal((await run()).status, "created");
      assert.equal((await run()).status, "skipped");
    }
    return { firstAttempt, financialPosts, stored, delivered };
  }
  it("automatically retries transient reads with no initial financial write, then creates exactly once", async () => {
    for (const failure of ["ledger503", "ledger429", "network", "session503"] as const) {
      const result = await scenario(failure);
      assert.equal(result.firstAttempt.financialPosts, 0); assert.equal(result.firstAttempt.failure.invoiceCreationManualReview, false);
      assert.deepEqual(result.firstAttempt.safe, ["fixture"]);
      assert.equal(result.financialPosts, 1); assert.equal(result.stored, 1); assert.equal(result.delivered, 1);
    }
  });
  it("does not automatically retry invalid mappings or permission errors", async () => {
    for (const failure of ["mapping", "ledger403"] as const) {
      const result = await scenario(failure);
      assert.equal(result.financialPosts, 0); assert.deepEqual(result.firstAttempt.safe, []);
      assert.equal(result.stored, 0); assert.equal(result.delivered, 0);
    }
  });
  it("keeps timeout and 503 outcomes after invoice POST on manual hold", async () => {
    for (const failure of ["postTimeout", "post503"] as const) {
      const result = await scenario(failure);
      assert.equal(result.financialPosts, 1); assert.equal(result.firstAttempt.failure.invoiceCreationManualReview, true);
      assert.deepEqual(result.firstAttempt.safe, []); assert.equal(result.stored, 0); assert.equal(result.delivered, 0);
    }
  });
  it("does not misclassify refresh or retry failures after an initial invoice request as preflight", async () => {
    for (const failure of ["post401Refresh503", "post401RetryTimeout"] as const) {
      const result = await scenario(failure);
      assert.equal(result.financialPosts, failure === "post401Refresh503" ? 1 : 2);
      assert.equal(result.firstAttempt.failure.invoiceCreationManualReview, true);
      assert.deepEqual(result.firstAttempt.safe, []); assert.equal(result.stored, 0); assert.equal(result.delivered, 0);
    }
  });
});

describe("explicit replacement recovery", () => {
  for (const ownerType of ["payment", "recurring_schedule"] as const) {
    it(`requires a posted sale and preserves the selected replacement date for ${ownerType}`, async () => {
      for (const posted of [false, true]) {
        let stored = 0, sent = 0;
        const replacement = { ...invoice, id: 43 };
        const checks = verification(replacement, posted ? [sale] : []);
        const store = async () => { stored++; return { invoiceId: "43", invoiceNumber: invoice.invoiceNumber }; };
        const runtime = loadIsolated<typeof import("@/lib/eboekhouden/manual-invoice-recovery")>("lib/eboekhouden/manual-invoice-recovery.ts", {
          "server-only": {}, "drizzle-orm": { sql: (parts: TemplateStringsArray) => parts.join("?") },
          "@/lib/billing-settings": { getTenantBillingSettings: async () => ({ taxTreatment: "kor" }) },
          "@/lib/db": { getDb: () => ({ execute: async () => ({ rows: [{ originalInvoice: { id: 42 } }] }) }) },
          "@/lib/eboekhouden/client": { getEboekhoudenInvoice: async () => replacement },
          "@/lib/eboekhouden/first-payment-invoice-recovery": { listFailedFirstPaymentRecoveryCandidates: async () => [candidate], storeRecoveredFailedFirstPaymentSuccess: store },
          "@/lib/eboekhouden/recurring-invoice-recovery": { listFailedRecurringRecoveryCandidates: async () => [candidate], storeRecoveredFailedInvoiceSuccess: store },
          "@/lib/eboekhouden/invoice-total-verification": checks.verifier,
          "@/lib/invoice-delivery": { deliverCustomerInvoiceEmail: async () => { sent++; } },
          "@/lib/invoicing/tax-treatment": tax,
        });
        const run = () => runtime.recoverCreditedEboekhoudenInvoice({ apply: true, creditNoteNumber: "C-fixture", creditedInvoiceId: 42, replacementInvoiceId: 43,
          ownerId: "fixture", ownerType, operatorEmail: "fixture@example.test", mode: "live", tenantId: "fixture" });
        if (posted) assert.equal((await run()).status, "reconciled");
        else await assert.rejects(run, /exactly one sales posting/);
        assert.equal(stored, posted ? 1 : 0); assert.equal(sent, posted ? 1 : 0);
        assert.equal(checks.reads(), 1);
      }
    });
  }
});
