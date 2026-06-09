import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("customer billing repair module boundary", () => {
  it("moves the repair routine out of the onboarding action file", () => {
    const actionsSource = readFileSync(resolve("lib/onboarding/actions.ts"), "utf8");
    const repairSource = readFileSync(
      resolve("lib/onboarding/customer-billing-repair.ts"),
      "utf8",
    );

    assert.match(actionsSource, /@\/lib\/onboarding\/customer-billing-repair/);
    assert.doesNotMatch(actionsSource, /mollie\.customerMandates\.page/);
    assert.doesNotMatch(actionsSource, /action: "customer\.repair"/);
    assert.match(repairSource, /mollie\.customerMandates\.page/);
    assert.match(repairSource, /action: "customer\.repair"/);
    assert.match(repairSource, /update customers/);
  });
});
