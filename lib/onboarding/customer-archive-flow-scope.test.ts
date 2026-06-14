import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const actionsSource = readFileSync("lib/onboarding/actions.ts", "utf8");
const archiveFlowSource = readFileSync(
  "lib/onboarding/customer-archive-flow.ts",
  "utf8",
);

describe("customer archive flow module boundary", () => {
  it("moves archive and restore state transitions out of the main actions file", () => {
    assert.match(actionsSource, /@\/lib\/onboarding\/customer-archive-flow/);
    assert.match(archiveFlowSource, /export async function archiveCustomerRecord/);
    assert.match(archiveFlowSource, /export async function restoreCustomerRecord/);
    assert.match(archiveFlowSource, /resolveCustomerArchiveBlocker/);
    assert.match(archiveFlowSource, /resolveCustomerRestoreBlocker/);
    assert.match(archiveFlowSource, /writeAuditLog/);
    assert.doesNotMatch(actionsSource, /resolveCustomerArchiveBlocker/);
    assert.doesNotMatch(actionsSource, /resolveCustomerRestoreBlocker/);
    assert.doesNotMatch(actionsSource, /action: "customer\\.archive"/);
    assert.doesNotMatch(actionsSource, /action: "customer\\.restore"/);
  });
});
