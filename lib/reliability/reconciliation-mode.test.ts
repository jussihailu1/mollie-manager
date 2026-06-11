import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatReconciliationMode,
  shouldRunBillingFollowups,
} from "@/lib/reliability/reconciliation-mode";

describe("reconciliation mode helpers", () => {
  it("formats reconciliation mode labels", () => {
    assert.equal(formatReconciliationMode("full"), "Full");
    assert.equal(formatReconciliationMode("sync_only"), "Sync-only");
  });

  it("only runs follow-ups for full reconciliation", () => {
    assert.equal(shouldRunBillingFollowups("full"), true);
    assert.equal(shouldRunBillingFollowups("sync_only"), false);
  });
});
