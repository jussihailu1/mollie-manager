import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const workflowSource = readFileSync(
  "lib/eboekhouden/first-payment-invoice-workflow.ts",
  "utf8",
);
const candidateSource = readFileSync(
  "lib/eboekhouden/first-payment-invoice-candidate.ts",
  "utf8",
);

describe("first-payment invoice candidate module boundary", () => {
  it("moves candidate lookup sql out of the main invoice file", () => {
    assert.match(workflowSource, /@\/lib\/eboekhouden\/first-payment-invoice-candidate/);
    assert.match(candidateSource, /buildDeterministicMatchCte/);
    assert.match(candidateSource, /from payments p/);
    assert.match(candidateSource, /p\.tenant_id as "tenantId"/);
    assert.doesNotMatch(workflowSource, /async function getFirstPaymentInvoiceCandidate/);
  });
});
