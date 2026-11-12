import assert from "node:assert/strict";
import test from "node:test";
import { assertPaymentReceipt, previewPaymentReceipt, receiptPaymentDate, type ReceiptLink, type ReceiptPayment } from "./payment-receipt-preview";
import type { SalesMutation } from "./invoice-posting";
import type { EboekhoudenInvoice } from "./client";

function fixture() {
  const invoice: EboekhoudenInvoice = { id: 100, invoiceNumber: "F00037", relationId: 20, date: "2026-06-01", reference: "RB-original",
    termOfPayment: 9, totalAmount: 19.99, totalExcl: 19.99, vatAmount: 0, inExVat: "EX",
    items: [{ quantity: 1, pricePerUnit: 19.99, vatCode: "GEEN", ledgerId: 2, description: "Hosting" }] };
  const payment: ReceiptPayment = { resource: "payment", id: "tr_test123", mode: "live", profileId: "pfl_test", customerId: "cst_test",
    subscriptionId: "sub_test", sequenceType: "recurring", status: "paid", paidAt: "2026-06-10T23:55:13+00:00",
    amount: { value: "19.99", currency: "EUR" }, amountRefunded: { value: "0.00", currency: "EUR" },
    amountRemaining: { value: "19.99", currency: "EUR" }, _links: { self: {} } };
  const link: ReceiptLink = { tenantId: "tenant", mode: "live", invoiceId: "invoice", providerInvoiceId: "100", invoiceNumber: "F00037",
    relationId: 20, paymentId: "payment", molliePaymentId: payment.id, customerId: "customer", mollieCustomerId: "cst_test",
    mollieSubscriptionId: "sub_test", ownerType: "recurring_schedule", ownerId: "schedule", schedulePaymentId: "payment",
    paymentType: "recurring", status: "paid", paidAt: "2026-06-10T23:55:13.000Z", amount: payment.amount };
  const sale: SalesMutation = { id: 337, type: 2, date: invoice.date!, invoiceNumber: "F00037", relationId: 20, ledgerId: 1, inExVat: "EX",
    rows: [{ ledgerId: 2, amount: 19.99, vatCode: "GEEN" }] };
  const input: Parameters<typeof previewPaymentReceipt>[0] = { tenantId: "tenant", mode: "live", profileId: "pfl_test", link, payment, invoice,
    ledgers: [{ id: 1, category: "DEB" }, { id: 2, category: "VW" }, { id: 3, category: "FIN", code: "1030" }], mutations: [sale],
    outstanding: [{ mutationId: 337, invoiceNumber: "F00037", relationId: 20, totalAmount: 19.99, paidAmount: 0, outstandingAmount: 19.99 }],
    clearingLedgerId: 3, allLinks: [link] };
  return { input, run: () => previewPaymentReceipt(input) };
}

test("uses gross payment and Amsterdam paid date without altering the original invoice date", () => {
  const f = fixture(); const before = JSON.stringify(f.input); const result = f.run();
  assert.equal(result.status, "missing_receipt"); assert.equal(result.proposedMutation?.date, "2026-06-11");
  assert.equal(result.originalInvoiceDate, "2026-06-01"); assert.equal(result.proposedMutation?.type, 3);
  assert.equal(result.proposedMutation?.rows[0].amount, 19.99); assert.equal(result.proposedMutation?.ledgerId, 3);
  assert.equal(result.proposedMutation?.entryNumber, "KIFY-PAY-tr_test123"); assert.equal(result.proposedMutation?.checkPaymentReference, true);
  assert.equal(JSON.stringify(f.input), before);
});

test("payment dates handle summer/winter offsets and require a timezone", () => {
  assert.equal(receiptPaymentDate("2026-10-04T22:56:47Z"), "2026-10-05");
  assert.equal(receiptPaymentDate("2026-11-03T23:30:00Z"), "2026-11-04");
  assert.throws(() => receiptPaymentDate("2026-06-10")); assert.throws(() => receiptPaymentDate("invalid"));
});

test("missing clearing mapping returns no executable payload; non-FIN ledger is held", () => {
  const f = fixture(); f.input.clearingLedgerId = undefined;
  assert.equal(f.run().status, "clearing_account_required"); assert.equal(f.run().proposedMutation, null);
  f.input.clearingLedgerId = 2; assert.equal(f.run().status, "review_required");
});

test("tenant, mode, profile, relation, customer and subscription mismatches are held", () => {
  for (const patch of [{ mode: "test" }, { profileId: "other" }, { customerId: "other" }, { subscriptionId: "other" }, { resource: "refund" }, { id: "tr_other" }]) {
    const f = fixture(); Object.assign(f.input.payment, patch); assert.equal(f.run().status, "review_required");
  }
  for (const patch of [{ tenantId: "other" }, { mode: "test" }, { relationId: 99 }, { providerInvoiceId: "99" }, { schedulePaymentId: "other" }]) {
    const f = fixture(); Object.assign(f.input.link, patch); assert.equal(f.run().status, "review_required");
  }
});

test("ambiguous ownership and duplicate invoice/payment bindings are held", () => {
  const f = fixture(); f.input.allLinks.push({ ...f.input.link, invoiceId: "other" }); assert.equal(f.run().status, "review_required");
  const g = fixture(); g.input.allLinks = []; assert.equal(g.run().status, "review_required");
});

test("unpaid, disputed and mismatched timestamps are held", () => {
  for (const status of ["open", "pending", "authorized", "failed", "expired", "canceled"]) {
    const f = fixture(); f.input.payment.status = status; assert.equal(f.run().status, "review_required");
  }
  for (const patch of [{ disputedAt: "2026-06-12" }, { collectionReviewRequiredAt: "2026-06-12" }, { paidAt: "2026-06-09T10:00:00Z" }]) {
    const f = fixture(); Object.assign(f.input.link, patch); assert.equal(f.run().status, "review_required");
  }
});

test("refunds, chargebacks and partial capture are held even if status stays paid", () => {
  for (const patch of [ { amountRefunded: { value: "1.00", currency: "EUR" } }, { amountRefunded: undefined },
    { amountChargedBack: { value: "19.99", currency: "EUR" } }, { amountRemaining: { value: "18.99", currency: "EUR" } },
    { amountCaptured: { value: "10.00", currency: "EUR" } }, { _links: { refunds: {} } }, { _links: { chargebacks: {} } } ]) {
    const f = fixture(); Object.assign(f.input.payment, patch); assert.equal(f.run().status, "review_required");
  }
});

test("foreign currency, non-cent amounts, mandate cents and partial receipts are held", () => {
  for (const amount of [{ value: "19.99", currency: "USD" }, { value: "19.999", currency: "EUR" }, { value: "0.01", currency: "EUR" }, { value: "10.00", currency: "EUR" }]) {
    const f = fixture(); f.input.payment.amount = amount; assert.equal(f.run().status, "review_required");
  }
});

test("missing, duplicated or altered original sales are held", () => {
  const f = fixture(); f.input.mutations = []; assert.equal(f.run().status, "review_required");
  const g = fixture(); g.input.mutations.push({ ...g.input.mutations[0], id: 338 }); assert.equal(g.run().status, "review_required");
  const h = fixture(); h.input.mutations[0].date = "2026-06-05"; assert.equal(h.run().status, "review_required");
});

test("manual receipts, journal corrections and partial outstanding balances are held", () => {
  for (const type of [3, 5, 7]) {
    const f = fixture(); f.input.mutations.push({ id: 500, type, date: "2026-06-11", invoiceNumber: "F00037", rows: [{ ledgerId: 1, amount: 19.99, vatCode: "GEEN" }] });
    assert.equal(f.run().status, "review_required");
  }
  const f = fixture(); f.input.outstanding[0].paidAmount = 5; f.input.outstanding[0].outstandingAmount = 14.99;
  assert.equal(f.run().status, "review_required");
});

test("recognizes a fully verified existing receipt without requiring an open invoice", () => {
  const f = fixture(); const payload = f.run().proposedMutation!;
  f.input.mutations.push({ ...payload, id: 500, rows: [{ ...payload.rows[0], ledgerId: 1 }] }); f.input.outstanding = [];
  assert.equal(f.run().status, "already_posted"); assert.equal(f.run().proposedMutation, null);
  f.input.mutations.push({ ...f.input.mutations[1], id: 501 }); assert.equal(f.run().status, "review_required");
});

test("saved receipt verifier rejects wrong date, account, identity, VAT, amount or extra rows", () => {
  const f = fixture(); const payload = f.run().proposedMutation!;
  const receipt: SalesMutation = { ...payload, id: 500, rows: [{ ...payload.rows[0], ledgerId: 1 }] };
  assert.doesNotThrow(() => assertPaymentReceipt(payload, receipt, 1));
  for (const patch of [{ date: "2026-06-01" }, { ledgerId: 9 }, { entryNumber: "other" }, { relationId: 99 },
    { rows: [{ ...receipt.rows![0], amount: 19.56 }] }, { rows: [{ ...receipt.rows![0], vatCode: "HOOG_VERK_21" }] }, { rows: [...receipt.rows!, ...receipt.rows!] }]) {
    assert.throws(() => assertPaymentReceipt(payload, { ...receipt, ...patch }, 1));
  }
});

test("supports the exact first-payment owner and rejects mandate-only type", () => {
  const f = fixture(); Object.assign(f.input.link, { ownerType: "payment", ownerId: "payment", paymentType: "first" });
  f.input.payment.sequenceType = "first"; assert.equal(f.run().status, "missing_receipt");
  f.input.link.paymentType = "mandate_only"; assert.equal(f.run().status, "review_required");
});

test("accepts the observed type-3 response with blank entry number only with exact payment identity in both descriptions", () => {
  const f = fixture(); const payload = f.run().proposedMutation!;
  const saved: SalesMutation = { ...payload, id: 500, entryNumber: "", inExVat: "EX", rows: [{ ...payload.rows[0], ledgerId: 1 }] };
  assert.doesNotThrow(() => assertPaymentReceipt(payload, saved, 1));
  f.input.mutations.push(saved); f.input.outstanding = [];
  assert.equal(f.run().status, "already_posted");
  assert.throws(() => assertPaymentReceipt(payload, { ...saved, description: "Mollie tr_other" }, 1));
  assert.throws(() => assertPaymentReceipt(payload, { ...saved, rows: [{ ...saved.rows![0], description: "Mollie tr_other" }] }, 1));
  assert.throws(() => assertPaymentReceipt(payload, { ...saved, entryNumber: "wrong-nonempty-reference" }, 1));
});

function sameDayPair() {
  const first = fixture(); const second = fixture();
  Object.assign(second.input.invoice, { id: 101, invoiceNumber: "F00038", reference: "RB-other" });
  Object.assign(second.input.link, { invoiceId: "other-invoice", providerInvoiceId: "101", invoiceNumber: "F00038",
    paymentId: "other-payment", molliePaymentId: "tr_other456", ownerId: "other-schedule", schedulePaymentId: "other-payment",
    paidAt: "2026-06-10 23:55:13+00" });
  second.input.payment.id = "tr_other456";
  Object.assign(second.input.mutations[0], { id: 338, invoiceNumber: "F00038" });
  Object.assign(second.input.outstanding[0], { mutationId: 338, invoiceNumber: "F00038" });
  const links = [first.input.link, second.input.link];
  const mutations = [...first.input.mutations, ...second.input.mutations];
  const outstanding = [...first.input.outstanding, ...second.input.outstanding];
  first.input.allLinks = second.input.allLinks = links;
  first.input.mutations = second.input.mutations = mutations;
  first.input.outstanding = second.input.outstanding = outstanding;
  const save = (target: typeof first, id: number) => {
    const payload = target.run().proposedMutation!; assert.ok(payload);
    const receipt: SalesMutation = { ...payload, id, entryNumber: "", inExVat: "EX", rows: [{ ...payload.rows[0], ledgerId: 1 }] };
    mutations.push(receipt);
    outstanding.splice(outstanding.findIndex(item => item.invoiceNumber === payload.invoiceNumber), 1);
    return receipt;
  };
  return { first, second, save };
}

test("two same-customer, same-day, same-amount payments each receive their own invoice receipt", () => {
  const f = sameDayPair();
  assert.equal(f.first.run().status, "missing_receipt"); assert.equal(f.second.run().status, "missing_receipt");
  f.save(f.first, 500);
  assert.equal(f.first.run().status, "already_posted"); assert.equal(f.second.run().status, "missing_receipt");
  f.save(f.second, 501);
  assert.equal(f.first.run().status, "already_posted"); assert.equal(f.second.run().status, "already_posted");
  f.first.input.mutations.push({ ...f.first.input.mutations[2], id: 502 });
  assert.equal(f.first.run().status, "review_required");
});

test("same-day anonymous, unowned and malformed other receipts still require review", () => {
  for (const change of [
    (f: ReturnType<typeof sameDayPair>, receipt: SalesMutation) => { receipt.description = "Manual receipt"; receipt.rows![0].description = "Manual receipt"; },
    (f: ReturnType<typeof sameDayPair>) => { f.second.input.allLinks = [f.second.input.link]; },
    (_f: ReturnType<typeof sameDayPair>, receipt: SalesMutation) => { receipt.rows![0].relationId = 99; },
    (_f: ReturnType<typeof sameDayPair>, receipt: SalesMutation) => { receipt.entryNumber = "wrong-reference"; },
    (f: ReturnType<typeof sameDayPair>, receipt: SalesMutation) => { receipt.rows![0].description += ` ${f.second.input.payment.id}`; },
  ]) {
    const f = sameDayPair(); const receipt = f.save(f.first, 500); change(f, receipt);
    assert.equal(f.second.run().status, "review_required");
  }
});
