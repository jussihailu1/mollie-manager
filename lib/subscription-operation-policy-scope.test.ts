import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("subscription operation policy scope", () => {
  it("keeps operation decisions pure and provider side effects unavailable", () => {
    const policySource = readFileSync(
      resolve("lib/subscription-operation-policy.ts"),
      "utf8",
    );
    const actionSource = readFileSync(resolve("lib/operations/actions.ts"), "utf8");

    assert.doesNotMatch(policySource, /server-only|getDb|sql`|getMollieClient/);
    assert.doesNotMatch(actionSource, /cancelSubscriptionAction/);
    assert.doesNotMatch(actionSource, /customerSubscriptions\.cancel/);
  });

  it("does not present stopped future charges as a reversible pause", () => {
    const lifecycleSource = readFileSync(
      resolve("lib/customer-lifecycle-state.ts"),
      "utf8",
    );

    assert.match(lifecycleSource, /reason: "future_charges_stopped",\s+state: "cancelled"/);
  });
});
