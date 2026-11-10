import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

import * as tax from "@/lib/invoicing/tax-treatment";
import * as flow from "@/lib/eboekhouden/invoice-flow-helpers";
import { buildInvoiceCreationFailureMetadata } from "@/lib/eboekhouden/invoice-creation-metadata";
import { filterSafeFailedInvoiceRetryIds } from "@/lib/eboekhouden/invoice-retry-candidates";

// Execute the real orchestration with isolated provider/DB boundaries. No
// environment loading, live credentials, billing writes or emails are possible.
function scenario(kind: "first-payment" | "recurring", options: {
  existing?: boolean;
  uncertainPost?: boolean;
  duplicatePost?: boolean;
  verificationFailure?: boolean;
  searchFailure?: boolean;
  ambiguous?: boolean;
  amount?: string;
  frozenDate?: string;
  frozenReference?: string;
} = {}) {
  let state = "pending_invoice";
  let postCount = 0;
  let deliveries = 0;
  let verifications = 0;
  let searches = 0;
  let failure: ReturnType<typeof buildInvoiceCreationFailureMetadata> | undefined;
  let payload: Record<string, unknown> | undefined;
  const invoice = { id: 42, invoiceNumber: "F00054", totalAmount: 19.99, vatAmount: 0 };
  const candidate = {
    paymentId: "payment-1", scheduleId: "schedule-1", tenantId: "tenant-1",
    mode: "live", amountValue: options.amount ?? "19.99", eboekhoudenRelationId: 10,
    subscriptionDescription: "Subscription", invoiceSendDueDate: "2026-10-27",
    plannedCollectionDate: "2026-11-01", planSnapshot: { description: "Subscription" },
    expectedInvoiceDate: options.frozenDate,
    expectedInvoiceReference: options.frozenReference,
  };
  const settings = { taxTreatment: "kor", invoiceTemplateId: 12, revenueLedgerId: 13 };
  const claim = async (input: { invoiceDate: string; invoiceReference: string }) => {
    assert.equal(input.invoiceDate, options.frozenDate ?? "2026-10-27");
    assert.equal(input.invoiceReference, options.frozenReference ?? (kind === "first-payment" ? "FP-1" : "RB-1"));
    if (state !== "pending_invoice") return null;
    state = "invoice_creating";
    return "claimed";
  };
  const success = async () => {
    assert.equal(verifications, 1);
    state = "invoice_created";
    return { invoiceId: "42", invoiceNumber: "F00054" };
  };
  const fail = async (input: Parameters<typeof buildInvoiceCreationFailureMetadata>[0] & { error: Error }) => {
    state = "invoice_failed";
    failure = buildInvoiceCreationFailureMetadata({ ...input, errorMessage: input.error.message });
    return kind === "first-payment" ? { errorMessage: input.error.message } : input.error.message;
  };
  const modules: Record<string, unknown> = {
    "@/lib/billing-settings": { billingSettingsAreComplete: () => true, getTenantBillingSettings: async () => settings },
    "@/lib/eboekhouden/client": { createEboekhoudenInvoice: async (input: Record<string, unknown>) => {
      postCount++; payload = input;
      if (options.uncertainPost) throw new Error("Request timed out after provider accepted the invoice");
      if (options.duplicatePost) throw new Error("MUTA_008 betalingskenmerk bestaat al");
      return invoice;
    } },
    "@/lib/eboekhouden/invoice-total-verification": { verifiedEboekhoudenInvoice: async (input: { requireSalesPosting?: boolean; expectedDate: string }) => {
      assert.equal(input.requireSalesPosting, true, "Issuance/recovery must verify the sales posting before success or delivery");
      assert.equal(input.expectedDate, options.frozenDate ?? "2026-10-27");
      verifications++;
      if (options.verificationFailure) throw new Error("API VAT differs from the selected tax treatment");
      return invoice;
    } },
    "@/lib/eboekhouden/invoice-flow-helpers": flow,
    "@/lib/eboekhouden/invoice-reference": { buildFirstPaymentInvoiceReference: () => "FP-1", buildRecurringInvoiceReference: () => "RB-1" },
    "@/lib/eboekhouden/first-payment-invoice-eligibility": { describeFirstPaymentInvoiceEligibility: () => ({ status: "eligible", candidate }) },
    "@/lib/eboekhouden/first-payment-invoice-delivery": { buildFirstPaymentInvoiceDelivery: (input: unknown) => input },
    "@/lib/eboekhouden/first-payment-invoice-candidate": { getFirstPaymentInvoiceCandidate: async () => candidate },
    "@/lib/eboekhouden/recurring-invoice-candidate": { getScheduledInvoiceCandidate: async () => candidate },
    "@/lib/eboekhouden/first-payment-invoice-persistence": { claimFirstPaymentInvoiceForCreation: claim, storeFirstPaymentInvoiceCreationSuccess: success, storeFirstPaymentInvoiceCreationFailure: fail },
    "@/lib/eboekhouden/recurring-invoice-persistence": { claimScheduleForInvoice: claim, storeRecurringInvoiceCreationSuccess: success, storeRecurringInvoiceCreationFailure: fail },
    "@/lib/eboekhouden/first-payment-invoice-date": { resolveFirstPaymentInvoiceDate: () => "2026-10-27" },
    "@/lib/eboekhouden/invoice-reconcile": { findExistingEboekhoudenInvoiceByReference: async (input: { date: string; reference: string }) => {
      assert.equal(input.date, options.frozenDate ?? "2026-10-27");
      assert.equal(input.reference, options.frozenReference ?? (kind === "first-payment" ? "FP-1" : "RB-1"));
      searches++;
      if (options.searchFailure) throw new Error("Provider search unavailable");
      return options.ambiguous ? { status: "ambiguous" } : options.existing || (options.duplicatePost && searches > 1) ? { status: "found", invoice } : { status: "none" };
    } },
    "@/lib/invoice-delivery": { deliverCustomerInvoiceEmail: async () => { assert.equal(state, "invoice_created"); deliveries++; } },
    "@/lib/subscription-consent": { subscriptionConsentPlanSnapshotSchema: { safeParse: () => ({ success: true, data: candidate.planSnapshot }) } },
    "@/lib/invoicing/tax-treatment": tax,
  };
  const source = readFileSync(`lib/eboekhouden/${kind}-invoice-workflow.ts`, "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: Record<string, (id: string, options: { tenantId: string }) => Promise<{ status: string }>> = {};
  runInNewContext(js, { exports, Error, Date, require: (id: string) => {
    assert.ok(id in modules, `Unexpected dependency ${id}`);
    return modules[id];
  } });
  const execute = exports[kind === "first-payment" ? "createEboekhoudenInvoiceForFirstPayment" : "createEboekhoudenInvoiceForSchedule"];
  return {
    run: () => execute("owner-1", { tenantId: "tenant-1" }),
    snapshot: () => ({ state, postCount, deliveries, verifications, failure, payload }),
  };
}

for (const kind of ["first-payment", "recurring"] as const) describe(`${kind} verified issuance`, () => {
  it("keeps the frozen issuance date and reference after source dates change", async () => {
    const s = scenario(kind, { frozenDate: "2026-06-01", frozenReference: "original-reference" });
    assert.equal((await s.run()).status, "created");
    assert.equal(s.snapshot().payload?.date, "2026-06-01");
    assert.equal(s.snapshot().payload?.reference, "original-reference");
  });
  it("creates one inclusive KOR invoice, verifies before storing/delivery, and skips a second claim", async () => {
    const s = scenario(kind);
    assert.equal((await s.run()).status, "created");
    assert.equal((await s.run()).status, "skipped");
    const result = s.snapshot();
    assert.equal(result.postCount, 1);
    assert.equal(result.deliveries, 1);
    assert.equal(result.payload?.inExVat, "IN");
    const item = (result.payload?.items as Array<Record<string, unknown>>)[0];
    assert.equal(item.pricePerUnit, 19.99);
    assert.equal(item.vatCode, "GEEN");
    assert.match(String(item.description), /kleineondernemersregeling/);
  });

  it("holds an uncertain POST without delivery or a second POST", async () => {
    const s = scenario(kind, { uncertainPost: true });
    assert.equal((await s.run()).status, "failed");
    assert.equal((await s.run()).status, "skipped");
    const result = s.snapshot();
    assert.equal(result.postCount, 1);
    assert.equal(result.deliveries, 0);
    assert.equal(result.failure?.invoiceCreationManualReview, true);
    assert.deepEqual(filterSafeFailedInvoiceRetryIds([{ id: "owner-1", errorMessage: "FACT_014", manualReview: result.failure?.invoiceCreationManualReview }]), []);
  });

  it("holds a failed verification with the upstream identity and no delivery", async () => {
    const s = scenario(kind, { verificationFailure: true });
    assert.equal((await s.run()).status, "failed");
    assert.equal((await s.run()).status, "skipped");
    const result = s.snapshot();
    assert.equal(result.postCount, 1);
    assert.equal(result.deliveries, 0);
    assert.equal(result.failure?.eboekhoudenUnverifiedInvoice?.id, 42);
    assert.equal(result.failure?.invoiceCreationManualReview, true);
  });

  it("verifies an existing match without creating another invoice", async () => {
    for (const verificationFailure of [false, true]) {
      const s = scenario(kind, { existing: true, verificationFailure });
      assert.equal((await s.run()).status, verificationFailure ? "failed" : "created");
      assert.equal(s.snapshot().postCount, 0);
      assert.equal(s.snapshot().verifications, 1);
      assert.equal(s.snapshot().deliveries, verificationFailure ? 0 : 1);
    }
  });

  it("recovers a provider duplicate reference only through verified reads, never a second POST", async () => {
    for (const verificationFailure of [false, true]) {
      const s = scenario(kind, { duplicatePost: true, verificationFailure });
      assert.equal((await s.run()).status, verificationFailure ? "failed" : "created");
      assert.equal((await s.run()).status, "skipped");
      assert.equal(s.snapshot().postCount, 1);
      assert.equal(s.snapshot().verifications, 1);
      assert.equal(s.snapshot().deliveries, verificationFailure ? 0 : 1);
      if (verificationFailure) assert.equal(s.snapshot().failure?.invoiceCreationManualReview, true);
    }
  });

  it("does not POST after failed/ambiguous search or invalid amount", async () => {
    for (const options of [{ searchFailure: true }, { ambiguous: true }, { amount: "19.999" }]) {
      const s = scenario(kind, options);
      assert.equal((await s.run()).status, "failed");
      assert.equal(s.snapshot().postCount, 0);
      assert.equal(s.snapshot().deliveries, 0);
    }
  });
});

it("the standalone requeue command rechecks manual-review and stored-invoice guards in both selections and updates", () => {
  const source = readFileSync("scripts/invoice-automation-requeue-safe-failed.mjs", "utf8");
  const statements = source.match(/`[\s\S]*?`/g) ?? [];
  const invoiceStatements = statements.filter(statement => /invoice_state = 'invoice_failed'/.test(statement));
  assert.equal(invoiceStatements.length, 4);
  for (const statement of invoiceStatements) {
    assert.match(statement, /invoiceCreationManualReview', 'false'\) = 'false'/);
    assert.match(statement, /not exists \(select 1 from invoices i where i\.tenant_id =/);
  }
  assert.doesNotMatch(source, /\.eboekhouden_invoice_id|\.eboekhouden_invoice_number/);
  for (const kind of ["first-payment", "recurring"]) {
    const persistence = readFileSync(`lib/eboekhouden/${kind}-invoice-persistence.ts`, "utf8");
    assert.match(persistence, /invoice_state = 'pending_invoice'\s+and coalesce\(metadata ->> 'invoiceCreationManualReview', 'false'\) = 'false'/);
  }
});
