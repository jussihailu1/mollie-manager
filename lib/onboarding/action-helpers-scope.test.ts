import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const actionsSource = readFileSync("lib/onboarding/actions.ts", "utf8");
const helpersSource = readFileSync("lib/onboarding/action-helpers.ts", "utf8");

describe("onboarding action helpers boundary", () => {
  it("keeps redirect and relation helpers out of the main actions file", () => {
    assert.match(actionsSource, /@\/lib\/onboarding\/action-helpers/);
    assert.match(helpersSource, /export function redirectWithMessage/);
    assert.match(helpersSource, /export async function updateRelationFromLocalFields/);
    assert.match(helpersSource, /export async function getLocalCustomer/);
    assert.match(helpersSource, /export async function assertRelationIsAvailable/);
    assert.doesNotMatch(actionsSource, /function redirectWithMessage/);
    assert.doesNotMatch(actionsSource, /function serializeError/);
    assert.doesNotMatch(actionsSource, /function serializeIntegrationError/);
    assert.doesNotMatch(actionsSource, /async function updateRelationFromLocalFields/);
    assert.doesNotMatch(actionsSource, /async function getLocalCustomer/);
    assert.doesNotMatch(actionsSource, /async function assertRelationIsAvailable/);
  });
});
