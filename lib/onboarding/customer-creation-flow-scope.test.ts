import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const actionsSource = readFileSync("lib/onboarding/actions.ts", "utf8");
const flowSource = readFileSync(
  "lib/onboarding/customer-creation-flow.ts",
  "utf8",
);

describe("customer creation flow module boundary", () => {
  it("moves customer create/import orchestration out of the main actions file", () => {
    assert.match(actionsSource, /@\/lib\/onboarding\/customer-creation-flow/);
    assert.match(flowSource, /export async function createCustomerFlow/);
    assert.match(flowSource, /customers\.create/);
    assert.match(flowSource, /updateRelationFromLocalFields/);
    assert.match(flowSource, /insert into customers/);
    assert.doesNotMatch(actionsSource, /customers\.create/);
    assert.doesNotMatch(actionsSource, /updateRelationFromLocalFields\(relationIdToLink/);
    assert.doesNotMatch(actionsSource, /insert into customers/);
  });
});
