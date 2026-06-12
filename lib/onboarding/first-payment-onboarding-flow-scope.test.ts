import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const actionsSource = readFileSync("lib/onboarding/actions.ts", "utf8");
const flowSource = readFileSync(
  "lib/onboarding/first-payment-onboarding-flow.ts",
  "utf8",
);

describe("first-payment onboarding flow module boundary", () => {
  it("moves first-payment onboarding orchestration out of the main actions file", () => {
    assert.match(actionsSource, /@\/lib\/onboarding\/first-payment-onboarding-flow/);
    assert.match(flowSource, /buildFirstPaymentPlan/);
    assert.match(flowSource, /buildFirstPaymentOnboardingRecords/);
    assert.match(flowSource, /persistFirstPaymentOnboardingRecords/);
    assert.match(flowSource, /paymentLinks\.create/);
    assert.doesNotMatch(actionsSource, /buildFirstPaymentPlan/);
    assert.doesNotMatch(actionsSource, /buildFirstPaymentOnboardingRecords/);
    assert.doesNotMatch(actionsSource, /persistFirstPaymentOnboardingRecords/);
    assert.doesNotMatch(actionsSource, /paymentLinks\.create/);
  });
});
