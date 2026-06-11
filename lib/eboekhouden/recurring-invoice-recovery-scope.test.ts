import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const invoiceSource = readFileSync("lib/eboekhouden/recurring-invoices.ts", "utf8");
const recoverySource = readFileSync(
  "lib/eboekhouden/recurring-invoice-recovery.ts",
  "utf8",
);

describe("recurring invoice recovery module boundary", () => {
  it("keeps failed-row recovery helpers out of the main recurring invoice file", () => {
    assert.match(invoiceSource, /@\/lib\/eboekhouden\/recurring-invoice-recovery/);
    assert.match(
      recoverySource,
      /export async function listFailedRecurringRecoveryCandidates/,
    );
    assert.match(
      recoverySource,
      /export async function storeRecoveredFailedInvoiceSuccess/,
    );
    assert.doesNotMatch(
      invoiceSource,
      /async function listFailedRecurringRecoveryCandidates/,
    );
    assert.doesNotMatch(
      invoiceSource,
      /async function storeRecoveredFailedInvoiceSuccess/,
    );
  });
});
