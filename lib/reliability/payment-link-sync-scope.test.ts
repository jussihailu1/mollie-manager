import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const syncSource = readFileSync("lib/reliability/sync.ts", "utf8");
const paymentLinkSyncSource = readFileSync(
  "lib/reliability/payment-link-sync.ts",
  "utf8",
);

describe("payment link sync module boundary", () => {
  it("keeps payment-link sync helpers out of the main sync file", () => {
    assert.match(syncSource, /@\/lib\/reliability\/payment-link-sync/);
    assert.match(paymentLinkSyncSource, /export async function collectPaymentLinkPayments/);
    assert.match(
      paymentLinkSyncSource,
      /export async function upsertPaymentLinkFromMollie/,
    );
    assert.match(
      paymentLinkSyncSource,
      /export async function syncMatchingPaymentLinkForPayment/,
    );
    assert.doesNotMatch(syncSource, /async function collectPaymentLinkPayments/);
    assert.doesNotMatch(syncSource, /async function upsertPaymentLinkFromMollie/);
    assert.doesNotMatch(
      syncSource,
      /async function syncMatchingPaymentLinkForPayment/,
    );
  });
});
