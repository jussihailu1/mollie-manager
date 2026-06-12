import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const syncSource = readFileSync("lib/reliability/sync.ts", "utf8");
const lookupSource = readFileSync("lib/reliability/sync-mollie-lookups.ts", "utf8");

describe("sync mollie lookup module boundary", () => {
  it("keeps lookup wrappers out of the main sync file", () => {
    assert.match(syncSource, /@\/lib\/reliability\/sync-mollie-lookups/);
    assert.match(lookupSource, /export async function findPaymentAcrossModes/);
    assert.match(lookupSource, /export async function findPaymentLinkAcrossModes/);
    assert.match(lookupSource, /export async function findSubscriptionAcrossModes/);
    assert.doesNotMatch(syncSource, /async function findPaymentAcrossModes/);
    assert.doesNotMatch(syncSource, /async function findPaymentLinkAcrossModes/);
    assert.doesNotMatch(syncSource, /async function findSubscriptionAcrossModes/);
  });
});
