import assert from "node:assert/strict";
import { it } from "node:test";
import { onboardingHeartbeatIssues } from "./onboarding-heartbeat";

const now = Date.parse("2026-11-06T15:00:00Z");
const check = (lastScheduledSuccessAt: string | null) => onboardingHeartbeatIssues({ tenantId: "tenant-1", tenantName: "Business", lastScheduledSuccessAt, now });
it("does not alert for a recent scheduled success", () => {
  assert.equal(check("2026-11-06T14:55:00Z").length, 0);
  assert.equal(check("2026-11-06T14:00:00Z").length, 0);
});
it("alerts for absent, stale or invalid scheduler evidence", () => {
  for (const date of [null, "invalid", "2026-11-06T13:59:59Z", "2026-11-07T00:00:00Z"]) {
    const issues = check(date);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].tenantId, "tenant-1");
    assert.match(issues[0].stage, /No successful scheduled onboarding recovery/);
  }
});
