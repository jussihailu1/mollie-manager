import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const invoiceSource = readFileSync("lib/eboekhouden/first-payment-invoices.ts", "utf8");
const recoverySource = readFileSync(
  "lib/eboekhouden/first-payment-invoice-recovery.ts",
  "utf8",
);

describe("first-payment invoice recovery module boundary", () => {
  it("keeps failed-row recovery helpers out of the main invoice file", () => {
    assert.match(invoiceSource, /@\/lib\/eboekhouden\/first-payment-invoice-recovery/);
    assert.match(
      recoverySource,
      /export async function listFailedFirstPaymentRecoveryCandidates/,
    );
    assert.match(
      recoverySource,
      /export async function storeRecoveredFailedFirstPaymentSuccess/,
    );
    assert.doesNotMatch(
      invoiceSource,
      /async function listFailedFirstPaymentRecoveryCandidates/,
    );
    assert.doesNotMatch(
      invoiceSource,
      /async function storeRecoveredFailedFirstPaymentSuccess/,
    );
  });
});
