import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const syncSource = readFileSync("lib/reliability/sync.ts", "utf8");
const subscriptionSyncSource = readFileSync(
  "lib/reliability/subscription-sync-operations.ts",
  "utf8",
);

describe("subscription sync operations module boundary", () => {
  it("keeps subscription sync handlers out of the main sync file", () => {
    assert.match(syncSource, /@\/lib\/reliability\/subscription-sync-operations/);
    assert.match(
      subscriptionSyncSource,
      /export async function syncSubscriptionByLocalId/,
    );
    assert.match(
      subscriptionSyncSource,
      /export async function syncSubscriptionByMollieId/,
    );
    assert.doesNotMatch(syncSource, /export async function syncSubscriptionByLocalId/);
    assert.doesNotMatch(
      syncSource,
      /export async function syncSubscriptionByMollieId/,
    );
  });
});
