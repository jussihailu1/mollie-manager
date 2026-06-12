import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const recurringSource = readFileSync(
  "lib/eboekhouden/recurring-invoices.ts",
  "utf8",
);
const candidateSource = readFileSync(
  "lib/eboekhouden/recurring-invoice-candidate.ts",
  "utf8",
);

describe("recurring invoice candidate module boundary", () => {
  it("moves candidate lookup sql out of the main recurring invoice file", () => {
    assert.match(recurringSource, /@\/lib\/eboekhouden\/recurring-invoice-candidate/);
    assert.match(candidateSource, /from recurring_billing_schedules rbs/);
    assert.doesNotMatch(recurringSource, /async function getScheduledInvoiceCandidate/);
  });
});
