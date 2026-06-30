import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const syncSource = readFileSync("lib/reliability/sync.ts", "utf8");
const resourceStateSource = readFileSync(
  "lib/reliability/sync-resource-state.ts",
  "utf8",
);

describe("sync resource state module boundary", () => {
  it("keeps local lookup and mandate upsert helpers out of the main sync file", () => {
    assert.match(syncSource, /@\/lib\/reliability\/sync-resource-state/);
    assert.match(resourceStateSource, /export async function getLocalCustomerByMollieId/);
    assert.match(resourceStateSource, /export async function getManagedSubscription/);
    assert.match(
      resourceStateSource,
      /export async function upsertMandatesForCustomer/,
    );
    assert.doesNotMatch(syncSource, /async function getLocalCustomerByMollieId/);
    assert.doesNotMatch(syncSource, /async function getManagedSubscription/);
    assert.doesNotMatch(syncSource, /async function upsertMandatesForCustomer/);
    assert.doesNotMatch(resourceStateSource, /getSingleTenantIdOrThrow/);
    assert.match(resourceStateSource, /Tenant context is required\./);
  });
});
