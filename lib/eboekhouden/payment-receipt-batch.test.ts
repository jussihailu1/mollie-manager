import assert from "node:assert/strict";
import { it } from "node:test";
import { loadIsolated } from "@/lib/testing/isolated-module";
import type { ReceiptLink } from "./payment-receipt-preview";
import type { ReceiptSettings } from "./payment-receipt-contract";
import type { ReceiptOutcome } from "./payment-receipt-workflow";

const scope = { tenantId: "receipt-tenant", mode: "live" as const };
const settings: ReceiptSettings = { ...scope, enabled: true, profileId: "pfl_fixture", clearingLedgerId: 89,
  paymentsFrom: "2026-11-10T00:00:00Z", credentialVersion: "2026-11-09T00:00:00Z" };
function link(paymentId: string, patch: Partial<ReceiptLink> = {}): ReceiptLink {
  return { ...scope, invoiceId: `invoice-${paymentId}`, providerInvoiceId: "10", invoiceNumber: `F-${paymentId}`,
    relationId: 77, paymentId, molliePaymentId: `tr_${paymentId}`, customerId: "customer", mollieCustomerId: "cst_fixture",
    ownerType: "payment", ownerId: paymentId, paymentType: "first", status: "paid", paidAt: "2026-11-11T01:00:00Z",
    amount: { value: "19.99", currency: "EUR" }, ...patch };
}
function fixture(options: {
  flag?: string; settings?: ReceiptSettings | null; links?: ReceiptLink[];
  jobs?: { paymentId: string; status: string }[]; outcomes?: ReceiptOutcome[];
  cursorFailure?: boolean;
} = {}) {
  const calls: string[] = [];
  const processed: { tenantId: string; mode: string; paymentId: string }[] = [];
  const store = { getSettings: async (actualScope: typeof scope) => {
    assert.equal(actualScope.tenantId, scope.tenantId); assert.equal(actualScope.mode, "live");
    calls.push("settings"); return options.settings === undefined ? settings : options.settings;
  } };
  const create = () => assert.fail("batch must delegate all financial writes to verified workflow");
  const load = () => assert.fail("batch must delegate provider evidence reads to verified workflow");
  const batch = loadIsolated<typeof import("./payment-receipt-batch")>("lib/eboekhouden/payment-receipt-batch.ts", {
    "server-only": {}, "./client": { createEboekhoudenPaymentReceipt: create },
    "./payment-receipt-persistence": { receiptStore: store, advanceReceiptCursor: async (actual: ReceiptSettings, paymentId: string) => {
      assert.equal(actual.tenantId, scope.tenantId); assert.equal(actual.mode, "live");
      calls.push(`cursor:${paymentId}`);
      if (options.cursorFailure) throw new Error("Database unavailable");
      if (options.settings) options.settings.cursorPaymentId = paymentId;
    } },
    "./payment-receipt-runtime": {
      loadReceiptContext: load,
      listReceiptLinks: async (actualScope: typeof scope) => {
        assert.equal(actualScope.tenantId, scope.tenantId); assert.equal(actualScope.mode, "live");
        calls.push("links"); return options.links ?? [link("one")];
      },
      listUnverifiedReceiptPaymentIds: async (actualScope: typeof scope) => {
        assert.equal(actualScope.tenantId, scope.tenantId); assert.equal(actualScope.mode, "live");
        calls.push("jobs"); return options.jobs ?? [];
      },
    },
    "./payment-receipt-workflow": { runPaymentReceipt: async (input: typeof processed[number], dependencies: Record<string, unknown>) => {
      assert.equal(input.tenantId, scope.tenantId); assert.equal(input.mode, "live");
      assert.equal(dependencies.store, store); assert.equal(dependencies.load, load); assert.equal(dependencies.create, create);
      processed.push(input); return options.outcomes?.[processed.length - 1] ?? { status: "posted" };
    } },
  }, { process: { env: { EBOEKHOUDEN_RECEIPT_AUTOMATION_ENABLED: options.flag ?? "true" } } });
  return { batch, calls, processed, run: (limit = 25) => batch.processPaymentReceiptsBatch({ ...scope, limit }) };
}

for (const flag of ["", "false", "TRUE", "1"]) {
  it(`global flag ${JSON.stringify(flag)} exits without database or provider calls`, async () => {
    const f = fixture({ flag }); const result = await f.run();
    assert.equal(result.disabled, true); assert.equal(result.checkedCount, 0);
    assert.deepEqual(f.calls, []); assert.deepEqual(f.processed, []);
  });
}

it("test mode exits before settings or any provider request, even when globally enabled", async () => {
  const f = fixture(); const result = await f.batch.processPaymentReceiptsBatch({ tenantId: scope.tenantId, mode: "test", limit: 5 });
  assert.equal(result.disabled, true); assert.deepEqual(f.calls, []); assert.deepEqual(f.processed, []);
});

for (const disabledSettings of [null, { ...settings, enabled: false }]) {
  it(`missing/disabled tenant configuration does not discover or process receipts: ${disabledSettings === null ? "missing" : "disabled"}`, async () => {
    const f = fixture({ settings: disabledSettings }); const result = await f.run();
    assert.equal(result.disabled, true); assert.deepEqual(f.calls, ["settings"]); assert.deepEqual(f.processed, []);
  });
}

it("requires explicit tenant context before looking up configuration", async () => {
  const f = fixture();
  await assert.rejects(() => f.batch.processPaymentReceiptsBatch({ tenantId: "", mode: "live", limit: 5 }), /tenant context/);
  assert.deepEqual(f.calls, []);
});

it("skips verified, unpaid and pre-cutover payments, deduplicating current candidates", async () => {
  const f = fixture({ links: [link("complete"), link("old", { paidAt: "2026-11-09T23:59:59Z" }),
    link("unpaid", { status: "pending" }), link("one"), link("one"), link("two")],
    jobs: [{ paymentId: "complete", status: "verified" }, { paymentId: "one", status: "posting" }] });
  const result = await f.run();
  assert.deepEqual(f.processed.map(input => input.paymentId), ["one", "two"]);
  assert.equal(result.checkedCount, 2); assert.equal(result.postedCount, 2); assert.equal(result.remainingCount, 0);
});

it("processes at most five payments and reports the remaining eligible backlog", async () => {
  const f = fixture({ links: Array.from({ length: 8 }, (_, i) => link(`p${i}`)) });
  const result = await f.run(200);
  assert.equal(f.processed.length, 5); assert.equal(result.checkedCount, 5); assert.equal(result.remainingCount, 3);
  assert.ok(f.processed.every(input => input.tenantId === scope.tenantId && input.mode === "live"));
});

it("honors a smaller limit and safely bounds non-finite input", async () => {
  const limited = fixture({ links: [link("one"), link("two"), link("three")] });
  assert.equal((await limited.run(1)).remainingCount, 2); assert.equal(limited.processed.length, 1);
  const nonfinite = fixture({ links: Array.from({ length: 8 }, (_, i) => link(`p${i}`)) });
  assert.equal((await nonfinite.run(Number.NaN)).checkedCount, 5);
});

it("reports successful and unresolved outcomes separately without claiming all work succeeded", async () => {
  const f = fixture({ links: [link("a"), link("b"), link("c"), link("d"), link("e")], outcomes: [
    { status: "posted" }, { status: "reconciled" }, { status: "review_required" }, { status: "failed" }, { status: "busy" },
  ] });
  const result = await f.run();
  assert.equal(result.disabled, false); assert.equal(result.checkedCount, 5); assert.equal(result.postedCount, 1);
  assert.equal(result.reconciledCount, 1); assert.equal(result.reviewRequiredCount, 1); assert.equal(result.failedCount, 1); assert.equal(result.busyCount, 1);
});

it("reports configuration disabled during processing and recognizes an already verified concurrent result", async () => {
  const f = fixture({ links: [link("a"), link("b")], outcomes: [{ status: "disabled" }, { status: "already_verified" }] });
  const result = await f.run();
  assert.equal(result.disabled, true); assert.equal(result.reconciledCount, 1); assert.equal(result.postedCount, 0);
});

it("keeps attempted claims visible when their invoice disappears or payment ceases to be paid", async () => {
  const f = fixture({ links: [link("reversed", { status: "failed" })], jobs: [
    { paymentId: "missing", status: "posting" }, { paymentId: "reversed", status: "review_required" },
  ], outcomes: [{ status: "failed" }, { status: "review_required" }] });
  const result = await f.run();
  assert.deepEqual(f.processed.map(item => item.paymentId), ["missing", "reversed"]);
  assert.equal(result.failedCount, 1); assert.equal(result.reviewRequiredCount, 1);
});

it("rotates past permanent review holds and wraps so older claims also get checked", async () => {
  const f = fixture({ settings: { ...settings }, links: Array.from({ length: 7 }, (_, i) => link(`p${i}`)),
    outcomes: Array.from({ length: 15 }, () => ({ status: "review_required" })) });
  await f.run(); await f.run();
  assert.deepEqual(f.processed.map(item => item.paymentId), ["p0", "p1", "p2", "p3", "p4", "p5", "p6", "p0", "p1", "p2"]);
});

it("retains posted counts and reports unprocessed backlog when cursor persistence fails", async () => {
  const f = fixture({ links: [link("a"), link("b"), link("c")], cursorFailure: true });
  const result = await f.run();
  assert.equal(result.postedCount, 1); assert.equal(result.failedCount, 1); assert.equal(result.remainingCount, 2);
  assert.equal(f.processed.length, 1);
});

it("rejects foreign settings/candidates before executing a workflow or cursor update", async () => {
  for (const f of [fixture({ settings: { ...settings, tenantId: "foreign" } }), fixture({ links: [link("one", { tenantId: "foreign" })] })]) {
    await assert.rejects(f.run, /scope differs/); assert.equal(f.processed.length, 0);
  }
});
