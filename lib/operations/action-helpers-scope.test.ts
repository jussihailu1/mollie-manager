import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const actionsSource = readFileSync("lib/operations/actions.ts", "utf8");
const helpersSource = readFileSync("lib/operations/action-helpers.ts", "utf8");

describe("operations action helpers boundary", () => {
  it("keeps redirect and serialization helpers out of the main operations file", () => {
    assert.match(actionsSource, /@\/lib\/operations\/action-helpers/);
    assert.match(helpersSource, /export async function redirectWithMessage/);
    assert.match(helpersSource, /redirectWithActionFeedback/);
    assert.match(helpersSource, /export function serializeError/);
    assert.doesNotMatch(actionsSource, /function redirectWithMessage/);
    assert.doesNotMatch(actionsSource, /function serializeError/);
  });
});
