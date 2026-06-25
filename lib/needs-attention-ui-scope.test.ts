import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const dashboardSource = readFileSync(resolve("app/(dashboard)/page.tsx"), "utf8");
const notificationsSource = readFileSync(
  resolve("components/notifications-workspace.tsx"),
  "utf8",
);
const presentationSource = readFileSync(
  resolve("lib/needs-attention-presentation.ts"),
  "utf8",
);

describe("needs attention UI grouping", () => {
  it("defines priority and impact presentation helpers", () => {
    assert.match(presentationSource, /Critical priority/);
    assert.match(presentationSource, /Review soon/);
    assert.match(presentationSource, /Revenue and collection/);
    assert.match(presentationSource, /Customer setup and lifecycle/);
    assert.match(presentationSource, /System reliability/);
  });

  it("groups dashboard attention items by priority and shows business impact", () => {
    assert.match(dashboardSource, /getNeedsAttentionPriorityMeta/);
    assert.match(dashboardSource, /getNeedsAttentionImpact/);
    assert.match(dashboardSource, /groupedAttentionItems/);
    assert.match(dashboardSource, /priority\.title/);
    assert.match(dashboardSource, /priority\.description/);
    assert.match(dashboardSource, /impact\.label/);
    assert.match(dashboardSource, /impact\.description/);
  });

  it("groups notifications attention cards by priority and shows business impact", () => {
    assert.match(notificationsSource, /groupedAttentionAlerts/);
    assert.match(notificationsSource, /getNeedsAttentionPriorityMeta/);
    assert.match(notificationsSource, /getNeedsAttentionImpact/);
    assert.match(notificationsSource, /priority\.title/);
    assert.match(notificationsSource, /priority\.description/);
    assert.match(notificationsSource, /impact\.label/);
    assert.match(notificationsSource, /impact\.description/);
  });
});
