import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const drawerSource = readFileSync("components/customer-flow-dialogs.tsx", "utf8");
const workspaceSource = readFileSync("components/customers-workspace.tsx", "utf8");

describe("customer lifecycle UI surface", () => {
  it("derives lifecycle state in the customer UI without manual override fields", () => {
    assert.match(drawerSource, /deriveCustomerLifecycleState/);
    assert.match(drawerSource, /Lifecycle/);
    assert.match(drawerSource, /lifecycle\.summary/);
    assert.match(drawerSource, /lifecycle\.reason/);
    assert.doesNotMatch(drawerSource, /manual.*lifecycle/i);
    assert.doesNotMatch(drawerSource, /override.*lifecycle/i);
  });

  it("shows derived lifecycle badges in the customer workspace", () => {
    assert.match(workspaceSource, /getCustomerLifecycleBadge/);
  });
});
