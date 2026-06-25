import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const actionsSource = readFileSync("lib/onboarding/actions.ts", "utf8");
const flowSource = readFileSync(
  "lib/onboarding/customer-relation-link-flow.ts",
  "utf8",
);

describe("customer relation link flow module boundary", () => {
  it("moves relation-link orchestration out of the main actions file", () => {
    assert.match(actionsSource, /@\/lib\/onboarding\/customer-relation-link-flow/);
    assert.match(flowSource, /export async function linkCustomerToEboekhoudenRelation/);
    assert.match(flowSource, /updateRelationFromLocalFields/);
    assert.match(flowSource, /insert into customer_notes/);
    assert.match(flowSource, /normalizeCustomerNoteBody/);
    assert.doesNotMatch(flowSource, /\bnotes =/);
    assert.match(flowSource, /action: "customer\.eboekhouden\.link"/);
    assert.doesNotMatch(actionsSource, /action: "customer\.eboekhouden\.link"/);
    assert.doesNotMatch(actionsSource, /updateRelationFromLocalFields\(/);
  });
});
