import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("customer activity timeline surface", () => {
  it("serves sanitized customer activity through an authenticated customer api", () => {
    const source = readFileSync(
      resolve("app/api/customers/[customerId]/activity/route.ts"),
      "utf8",
    );

    assert.match(source, /requireViewerSession/);
    assert.match(source, /getSelectedMollieMode/);
    assert.match(source, /getCustomerDetail/);
    assert.match(source, /listCustomerActivityTimeline/);
    assert.match(source, /Response\.json\(\{ items, notifications \}\)/);
    assert.doesNotMatch(source, /\bdetails\b/);
    assert.doesNotMatch(source, /\bpayload\b/);
    assert.doesNotMatch(source, /\bmetadata\b/);
  });

  it("loads the activity timeline inside the customer drawer", () => {
    const source = readFileSync(resolve("components/customer-flow-dialogs.tsx"), "utf8");

    assert.match(source, /CustomerActivityTimeline/);
    assert.match(source, /activityTimeline/);
    assert.match(source, /\/api\/customers\/\$\{encodeURIComponent\(resolvedCustomerId\)\}\/activity/);
    assert.match(source, /Activity timeline/);
    assert.match(source, /TimelineRow/);
    assert.match(source, /getTimelineSeverityBadge/);
  });
});
