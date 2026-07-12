import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const queueSource = readFileSync(
  "lib/eboekhouden/first-payment-invoice-queue.ts",
  "utf8",
);
const invoiceSource = readFileSync(
  "lib/eboekhouden/first-payment-invoices.ts",
  "utf8",
);
const followUpSource = readFileSync(
  "lib/reliability/first-payment-sync-followup.ts",
  "utf8",
);

describe("first-payment invoice queue module boundary", () => {
  it("keeps queue and state normalization helpers out of the main invoice file", () => {
    assert.match(invoiceSource, /@\/lib\/eboekhouden\/first-payment-invoice-queue/);
    assert.match(followUpSource, /@\/lib\/eboekhouden\/first-payment-invoice-queue/);
    assert.match(queueSource, /export async function listDueFirstPaymentInvoiceCandidates/);
    assert.match(queueSource, /export async function normalizeFirstPaymentInvoiceStates/);
    assert.match(queueSource, /export async function getDueFirstPaymentInvoiceQueueSummary/);
    assert.doesNotMatch(queueSource, /getSingleTenantIdOrThrow/);
    assert.match(invoiceSource, /getTenantActiveInvoiceProvider/);
    assert.match(invoiceSource, /first-payment-invoice-queue/);
  });
});
