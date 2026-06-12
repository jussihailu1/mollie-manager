import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const firstPaymentSource = readFileSync(
  "lib/eboekhouden/first-payment-invoices.ts",
  "utf8",
);
const candidateSource = readFileSync(
  "lib/eboekhouden/first-payment-invoice-candidate.ts",
  "utf8",
);

describe("first-payment invoice candidate module boundary", () => {
  it("moves candidate lookup sql out of the main invoice file", () => {
    assert.match(firstPaymentSource, /@\/lib\/eboekhouden\/first-payment-invoice-candidate/);
    assert.match(candidateSource, /buildDeterministicMatchCte/);
    assert.match(candidateSource, /from payments p/);
    assert.doesNotMatch(firstPaymentSource, /async function getFirstPaymentInvoiceCandidate/);
    assert.doesNotMatch(firstPaymentSource, /buildDeterministicMatchCte/);
  });
});
