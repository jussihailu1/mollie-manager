import assert from "node:assert/strict";
import test from "node:test";
import type { ReceiptClaim, ReceiptJob, ReceiptSettings, ReceiptStore } from "./payment-receipt-contract";
import type { ReceiptMutationInput } from "./payment-receipt-preview";
import { runPaymentReceipt, type ReceiptContext, type ReceiptWorkflowDependencies } from "./payment-receipt-workflow";

function fixture() {
  const settings: ReceiptSettings = { tenantId: "tenant", mode: "live", enabled: true, profileId: "pfl_fixture",
    clearingLedgerId: 3, paymentsFrom: "2026-06-01T00:00:00Z", credentialVersion: "2026-05-01T00:00:00Z" };
  const context: ReceiptContext = {
    invoice: { id: 100, invoiceNumber: "F00037", relationId: 20, date: "2026-06-01", reference: "RB-original",
      termOfPayment: 9, totalAmount: 19.99, totalExcl: 19.99, vatAmount: 0, inExVat: "EX",
      items: [{ quantity: 1, pricePerUnit: 19.99, vatCode: "GEEN", ledgerId: 2, description: "Hosting" }] },
    payment: { resource: "payment", id: "tr_fixture", mode: "live", profileId: "pfl_fixture", customerId: "cst_fixture",
      subscriptionId: "sub_fixture", sequenceType: "recurring", status: "paid", paidAt: "2026-06-10T23:55:13Z",
      amount: { value: "19.99", currency: "EUR" }, amountRefunded: { value: "0.00", currency: "EUR" },
      amountRemaining: { value: "19.99", currency: "EUR" }, _links: { self: {} } },
    link: { tenantId: "tenant", mode: "live", invoiceId: "invoice", providerInvoiceId: "100", invoiceNumber: "F00037",
      relationId: 20, paymentId: "payment", molliePaymentId: "tr_fixture", customerId: "customer", mollieCustomerId: "cst_fixture",
      mollieSubscriptionId: "sub_fixture", ownerType: "recurring_schedule", ownerId: "schedule", schedulePaymentId: "payment",
      paymentType: "recurring", status: "paid", paidAt: "2026-06-10T23:55:13.000Z", amount: { value: "19.99", currency: "EUR" } },
    allLinks: [], ledgers: [{ id: 1, category: "DEB" }, { id: 2, category: "VW" }, { id: 3, category: "FIN", code: "1030" }],
    mutations: [{ id: 337, type: 2, date: "2026-06-01", invoiceNumber: "F00037", relationId: 20, ledgerId: 1, inExVat: "EX",
      rows: [{ ledgerId: 2, amount: 19.99, vatCode: "GEEN" }] }],
    outstanding: [{ mutationId: 337, invoiceNumber: "F00037", relationId: 20, totalAmount: 19.99, paidAmount: 0, outstandingAmount: 19.99 }],
  };
  context.allLinks = [context.link];
  const state = { job: null as ReceiptJob | null, settingsMissing: false, settingsReads: 0, loads: 0, claims: 0,
    posts: 0, releases: 0, marks: 0, token: 0, failBeforeWrite: false, failAfterWrite: false, acceptBeforeFailure: false,
    refuseMarker: false, refuseSave: false, throwSave: false, blankEntryNumber: true,
    onLoad: undefined as ((count: number) => void | Promise<void>) | undefined,
    beforeCreate: undefined as (() => void | Promise<void>) | undefined,
    alterSaved: undefined as (() => void) | undefined };
  const scoped = (input: { tenantId: string; mode: string }) => { assert.equal(input.tenantId, "tenant"); assert.equal(input.mode, "live"); };
  const owns = (input: ReceiptClaim) => { scoped(input); return !!state.job && input.id === state.job.id && !!input.claimToken && input.claimToken === state.job.claimToken; };
  const store: ReceiptStore = {
    async getSettings(input) { scoped(input); state.settingsReads++; return state.settingsMissing ? null : structuredClone(settings); },
    async getJob(input) { scoped(input); assert.equal(input.paymentId, "payment"); return structuredClone(state.job); },
    async claim(input) {
      scoped(input.settings); state.claims++;
      if (state.job?.claimToken || state.job?.status === "verified") return null;
      if (!state.job) state.job = { tenantId: "tenant", mode: "live", id: "job", invoiceId: input.link.invoiceId,
        paymentId: input.link.paymentId, molliePaymentId: input.link.molliePaymentId, profileId: input.settings.profileId,
        clearingLedgerId: input.settings.clearingLedgerId, credentialVersion: input.settings.credentialVersion,
        status: "prepared", attemptedAt: null, mutationId: null, claimToken: null, errorCode: null, ...structuredClone(input.evidence) };
      state.job.claimToken = `claim-${++state.token}`;
      return structuredClone(state.job);
    },
    async markPosting(input) {
      state.marks++;
      if (!owns(input) || state.refuseMarker || !settings.enabled || state.job!.status !== "prepared" || state.job!.attemptedAt ||
          input.settings.credentialVersion !== settings.credentialVersion || input.settings.clearingLedgerId !== settings.clearingLedgerId) return false;
      state.job!.status = "posting"; state.job!.attemptedAt = "2026-06-11T12:00:00Z"; return true;
    },
    async markVerified(input) {
      if (state.throwSave) throw new Error("private database connection error");
      if (!owns(input) || state.refuseSave) return false;
      state.job!.status = "verified"; state.job!.mutationId = input.mutationId; state.job!.claimToken = null; return true;
    },
    async markReview(input) {
      if (!owns(input)) return false;
      state.job!.status = "review_required"; state.job!.errorCode = input.errorCode; state.job!.claimToken = null; return true;
    },
    async releasePrepared(input) {
      if (!owns(input) || state.job!.status !== "prepared" || state.job!.attemptedAt) return false;
      state.releases++; state.job!.claimToken = null; return true;
    },
  };
  const accept = (payload: ReceiptMutationInput) => {
    context.mutations.push({ ...structuredClone(payload), id: 500, entryNumber: state.blankEntryNumber ? "" : payload.entryNumber,
      inExVat: "EX", rows: payload.rows.map(row => ({ ...row, ledgerId: 1 })) });
    context.outstanding = []; state.alterSaved?.();
  };
  const dependencies: ReceiptWorkflowDependencies = {
    store,
    async load(input, paymentId) { scoped(input); assert.equal(paymentId, "payment"); state.loads++; await state.onLoad?.(state.loads); return structuredClone(context); },
    async create(payload, tenantId, beforeWrite) {
      assert.equal(tenantId, "tenant"); await state.beforeCreate?.();
      if (state.failBeforeWrite) throw new Error("private provider authentication response");
      await beforeWrite(); assert.equal(state.job?.status, "posting"); state.posts++;
      if (state.failAfterWrite) { if (state.acceptBeforeFailure) accept(payload); throw new Error("private network details"); }
      accept(payload); return { id: 500 };
    },
  };
  const input = { tenantId: "tenant", mode: "live" as const, paymentId: "payment" };
  return { settings, context, state, store, dependencies, input,
    expire: () => { if (state.job) state.job.claimToken = null; },
    run: () => runPaymentReceipt(input, dependencies) };
}

test("posts one gross receipt on the payment date, preserves original invoice and recognizes repeated processing", async () => {
  const f = fixture(); const original = structuredClone(f.context.invoice);
  assert.deepEqual(await f.run(), { status: "posted", mutationId: 500 });
  assert.equal(f.state.posts, 1); assert.equal(f.state.job?.payload.date, "2026-06-11");
  assert.equal(f.state.job?.payload.rows[0].amount, 19.99); assert.equal(f.state.job?.status, "verified");
  assert.deepEqual(f.context.invoice, original); assert.deepEqual(f.context.outstanding, []);
  assert.deepEqual(await f.run(), { status: "already_verified", mutationId: 500 }); assert.equal(f.state.posts, 1);
});

test("two overlapping workers produce one POST and a busy result for the losing worker", async () => {
  const f = fixture(); let entered!: () => void; let release!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  f.state.beforeCreate = async () => { entered(); await gate; };
  const first = f.run(); await waiting;
  assert.deepEqual(await f.run(), { status: "busy" }); assert.equal(f.state.posts, 0);
  release(); assert.equal((await first).status, "posted"); assert.equal(f.state.posts, 1);
});

test("loss of the claim before the marker prevents the financial request", async () => {
  const f = fixture(); f.state.beforeCreate = () => { f.state.job!.claimToken = "another-worker"; };
  assert.equal((await f.run()).status, "failed"); assert.equal(f.state.posts, 0); assert.equal(f.state.job?.attemptedAt, null);
});

test("an accepted receipt with lost response reconciles on the next run without another POST", async () => {
  const f = fixture(); f.state.failAfterWrite = true; f.state.acceptBeforeFailure = true;
  assert.deepEqual(await f.run(), { status: "review_required", code: "post_outcome_unverified" });
  assert.equal(f.state.posts, 1); assert.equal(f.state.job?.status, "review_required");
  f.state.failAfterWrite = false;
  assert.deepEqual(await f.run(), { status: "reconciled", mutationId: 500 }); assert.equal(f.state.posts, 1);
});

test("an unknown POST with no provider match remains held across repeated runs", async () => {
  const f = fixture(); f.state.failAfterWrite = true;
  assert.equal((await f.run()).status, "review_required"); f.state.failAfterWrite = false;
  assert.deepEqual(await f.run(), { status: "review_required", code: "uncertain_post_requires_review" });
  assert.equal((await f.run()).status, "review_required"); assert.equal(f.state.posts, 1);
});

test("failed completion persistence recovers the accepted receipt after the lease expires", async () => {
  const f = fixture(); f.state.refuseSave = true;
  assert.deepEqual(await f.run(), { status: "failed", code: "verification_not_saved" });
  assert.equal(f.state.job?.status, "posting"); assert.equal(f.state.posts, 1);
  f.expire(); f.state.refuseSave = false;
  assert.deepEqual(await f.run(), { status: "reconciled", mutationId: 500 }); assert.equal(f.state.posts, 1);
});

test("a database exception after acceptance retains a reconcilable marker without exposing the error", async () => {
  const f = fixture(); f.state.throwSave = true;
  const outcome = await f.run(); assert.deepEqual(outcome, { status: "review_required", code: "post_outcome_unverified" });
  assert.doesNotMatch(JSON.stringify(outcome), /private|connection/); f.state.throwSave = false;
  assert.equal((await f.run()).status, "reconciled"); assert.equal(f.state.posts, 1);
});

test("authentication failure before the marker releases only the prepared claim for safe retry", async () => {
  const f = fixture(); f.state.failBeforeWrite = true;
  assert.deepEqual(await f.run(), { status: "failed", code: "preflight_unavailable" });
  assert.equal(f.state.posts, 0); assert.equal(f.state.marks, 0); assert.equal(f.state.releases, 1);
  assert.equal(f.state.job?.status, "prepared"); assert.equal(f.state.job?.attemptedAt, null);
  f.state.failBeforeWrite = false; assert.equal((await f.run()).status, "posted"); assert.equal(f.state.posts, 1);
});

test("frozen invoice date, reference, payment terms and gross amount cannot be changed by a retry", async () => {
  for (const change of ["date", "reference", "terms", "amount"] as const) {
    const f = fixture(); f.state.failBeforeWrite = true; await f.run(); f.state.failBeforeWrite = false;
    if (change === "date") { f.context.invoice.date = "2026-06-02"; f.context.mutations[0].date = "2026-06-02"; }
    if (change === "reference") f.context.invoice.reference = "RB-replacement";
    if (change === "terms") f.context.invoice.termOfPayment = 30;
    if (change === "amount") {
      f.context.invoice.totalAmount = 24.99; f.context.invoice.totalExcl = 24.99; f.context.invoice.items![0].pricePerUnit = 24.99;
      f.context.payment.amount.value = "24.99"; f.context.payment.amountRemaining!.value = "24.99"; f.context.link.amount.value = "24.99";
      f.context.mutations[0].rows![0].amount = 24.99;
      Object.assign(f.context.outstanding[0], { totalAmount: 24.99, outstandingAmount: 24.99 });
    }
    assert.equal((await f.run()).status, "review_required", change); assert.equal(f.state.posts, 0, change);
    assert.equal(f.state.job?.invoiceSnapshot.date, "2026-06-01"); assert.equal(f.state.job?.payload.rows[0].amount, 19.99);
  }
});

test("changed clearing account, Mollie profile or accounting credentials cannot redirect an existing job", async () => {
  for (const patch of [{ clearingLedgerId: 4 }, { profileId: "pfl_other" }, { credentialVersion: "2026-05-02T00:00:00Z" }]) {
    const f = fixture(); f.state.failBeforeWrite = true; await f.run(); Object.assign(f.settings, patch); f.state.failBeforeWrite = false;
    assert.deepEqual(await f.run(), { status: "review_required", code: "configuration_changed" }); assert.equal(f.state.posts, 0);
  }
});

test("configuration disabled after evidence reads stops at the durable marker", async () => {
  const f = fixture(); f.state.beforeCreate = () => { f.settings.enabled = false; };
  assert.equal((await f.run()).status, "failed"); assert.equal(f.state.posts, 0);
});

test("disabled or absent settings and test mode never load provider evidence or create a job", async () => {
  for (const kind of ["disabled", "absent", "test"] as const) {
    const f = fixture(); if (kind === "disabled") f.settings.enabled = false; if (kind === "absent") f.state.settingsMissing = true;
    const result = await runPaymentReceipt({ ...f.input, mode: kind === "test" ? "test" : "live" }, f.dependencies);
    assert.deepEqual(result, { status: "disabled" }); assert.equal(f.state.loads, 0); assert.equal(f.state.claims, 0); assert.equal(f.state.posts, 0);
    if (kind === "test") assert.equal(f.state.settingsReads, 0);
  }
});

test("cross-tenant, profile, invoice owner and test payment evidence are held", async () => {
  for (const alter of [
    (c: ReceiptContext) => { c.link.tenantId = "other"; },
    (c: ReceiptContext) => { c.payment.profileId = "pfl_other"; },
    (c: ReceiptContext) => { c.payment.mode = "test"; },
    (c: ReceiptContext) => { c.link.schedulePaymentId = "another-payment"; },
    (c: ReceiptContext) => { c.link.providerInvoiceId = "200"; },
  ]) {
    const f = fixture(); alter(f.context); assert.equal((await f.run()).status, "review_required"); assert.equal(f.state.posts, 0); assert.equal(f.state.claims, 0);
  }
});

test("old, future-dated and invalid-cutoff payments never become posting jobs", async () => {
  for (const kind of ["old", "future", "invalid"] as const) {
    const f = fixture();
    if (kind === "old") f.settings.paymentsFrom = "2026-06-11T00:00:00Z";
    if (kind === "invalid") f.settings.paymentsFrom = "invalid";
    if (kind === "future") { const future = new Date(Date.now() + 86400000).toISOString(); f.context.payment.paidAt = future; f.context.link.paidAt = future; }
    assert.equal((await f.run()).status, "review_required"); assert.equal(f.state.claims, 0); assert.equal(f.state.posts, 0);
  }
});

test("refunds, manual receipts, partial settlement and duplicate payment ownership prevent writes", async () => {
  for (const alter of [
    (c: ReceiptContext) => { c.payment.amountRefunded!.value = "1.00"; },
    (c: ReceiptContext) => { c.payment._links.chargebacks = {}; },
    (c: ReceiptContext) => { c.mutations.push({ id: 499, type: 3, invoiceNumber: "F00037" }); },
    (c: ReceiptContext) => { c.outstanding[0].paidAmount = 1; c.outstanding[0].outstandingAmount = 18.99; },
    (c: ReceiptContext) => { c.allLinks.push({ ...c.link, invoiceId: "duplicate" }); },
  ]) {
    const f = fixture(); alter(f.context); assert.equal((await f.run()).status, "review_required"); assert.equal(f.state.posts, 0);
  }
});

test("a refund or invoice edit between initial read and claimed read is held before POST", async () => {
  for (const kind of ["refund", "invoice"] as const) {
    const f = fixture(); f.state.onLoad = count => { if (count === 2) {
      if (kind === "refund") f.context.payment._links.refunds = {}; else f.context.invoice.reference = "changed";
    } };
    assert.deepEqual(await f.run(), { status: "review_required", code: "fresh_evidence_changed" }); assert.equal(f.state.posts, 0);
  }
});

test("provider responses with wrong identity, amount or duplicate receipt remain held after one POST", async () => {
  for (const kind of ["identity", "amount", "duplicate", "outstanding"] as const) {
    const f = fixture(); f.state.alterSaved = () => {
      const saved = f.context.mutations.at(-1)!;
      if (kind === "identity") saved.rows![0].description = "Mollie tr_wrong";
      if (kind === "amount") saved.rows![0].amount = 19;
      if (kind === "duplicate") f.context.mutations.push({ ...saved, id: 501 });
      if (kind === "outstanding") f.context.outstanding = [{ mutationId: 337, invoiceNumber: "F00037", outstandingAmount: 19.99 }];
    };
    assert.deepEqual(await f.run(), { status: "review_required", code: "saved_receipt_requires_review" }); assert.equal(f.state.posts, 1);
    assert.equal((await f.run()).status, "review_required"); assert.equal(f.state.posts, 1);
  }
});

test("an existing matching receipt is reconciled without another POST and blank optional entry number is supported", async () => {
  const f = fixture(); f.state.failAfterWrite = true; f.state.acceptBeforeFailure = true; await f.run();
  f.state.job = null; f.state.failAfterWrite = false;
  assert.equal(f.context.mutations.at(-1)?.entryNumber, "");
  assert.deepEqual(await f.run(), { status: "reconciled", mutationId: 500 }); assert.equal(f.state.posts, 1);
});

test("read failures and rejected claims do not initiate financial requests", async () => {
  const f = fixture(); f.state.onLoad = () => { throw new Error("sensitive provider body"); };
  assert.deepEqual(await f.run(), { status: "failed", code: "preflight_unavailable" }); assert.equal(f.state.posts, 0);
  const g = fixture(); g.store.claim = async () => null;
  assert.deepEqual(await g.run(), { status: "busy" }); assert.equal(g.state.posts, 0);
});

test("a failed fresh read releases an unattempted claim, while a review-held claim stays read-only", async () => {
  const f = fixture(); f.state.onLoad = count => { if (count === 2) throw new Error("Temporary read failure"); };
  assert.deepEqual(await f.run(), { status: "failed", code: "preflight_unavailable" });
  assert.equal(f.state.releases, 1); assert.equal(f.state.job?.attemptedAt, null); assert.equal(f.state.posts, 0);
  f.state.onLoad = undefined; assert.equal((await f.run()).status, "posted");

  const g = fixture(); g.state.onLoad = count => { if (count === 2) g.context.invoice.reference = "changed"; };
  assert.equal((await g.run()).status, "review_required"); assert.equal(g.state.job?.attemptedAt, null);
  g.state.onLoad = undefined; g.context.invoice.reference = "RB-original";
  assert.deepEqual(await g.run(), { status: "review_required", code: "uncertain_post_requires_review" }); assert.equal(g.state.posts, 0);
});

test("foreign settings or missing caller identity cannot touch provider evidence", async () => {
  const f = fixture(); f.settings.tenantId = "another-tenant";
  assert.deepEqual(await f.run(), { status: "review_required", code: "configuration_changed" });
  assert.equal(f.state.loads, 0); assert.equal(f.state.posts, 0);
  const g = fixture();
  assert.deepEqual(await runPaymentReceipt({ ...g.input, tenantId: "" }, g.dependencies), { status: "review_required", code: "identity_missing" });
  assert.equal(g.state.settingsReads, 0); assert.equal(g.state.loads, 0);
});
