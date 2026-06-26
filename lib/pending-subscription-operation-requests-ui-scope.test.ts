import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const pageSource = readFileSync(
  resolve("app/(dashboard)/notifications/page.tsx"),
  "utf8",
);
const workspaceSource = readFileSync(
  resolve("components/notifications-workspace.tsx"),
  "utf8",
);

describe("pending subscription request notifications surface", () => {
  it("loads unresolved requests into the notifications workspace", () => {
    assert.match(pageSource, /listPendingSubscriptionOperationRequests/);
    assert.match(pageSource, /pendingOperationRequests=\{operationRequestResult\}/);
  });

  it("renders pending subscription request controls without provider mutation", () => {
    assert.match(workspaceSource, /Pending subscription requests/);
    assert.match(workspaceSource, /Recorded lifecycle requests awaiting manual review or future execution/);
    assert.match(workspaceSource, /request\.requestedEffectiveAt/);
    assert.match(workspaceSource, /request\.cancellationEffect === "immediate"/);
    assert.match(workspaceSource, /withdrawOperationRequestAction/);
    assert.match(workspaceSource, /Withdraw request/);
    assert.match(workspaceSource, /Open customer/);
    assert.doesNotMatch(workspaceSource, /recordCancellationRequestAction/);
  });
});
