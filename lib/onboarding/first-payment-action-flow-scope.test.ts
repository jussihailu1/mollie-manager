import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const actionsSource = readFileSync("lib/onboarding/actions.ts", "utf8");
const flowSource = readFileSync(
  "lib/onboarding/first-payment-action-flow.ts",
  "utf8",
);

describe("first-payment action flow module boundary", () => {
  it("moves first-payment kickoff orchestration out of the main actions file", () => {
    assert.match(actionsSource, /@\/lib\/onboarding\/first-payment-action-flow/);
    assert.match(flowSource, /export async function createFirstPaymentActionFlow/);
    assert.match(flowSource, /resolveFirstPaymentCreationBlocker/);
    assert.match(flowSource, /createFirstPaymentOnboardingFlow/);
    assert.doesNotMatch(actionsSource, /resolveFirstPaymentCreationBlocker/);
    assert.doesNotMatch(actionsSource, /createFirstPaymentOnboardingFlow/);
  });
});
