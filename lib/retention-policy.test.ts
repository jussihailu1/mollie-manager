import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getRetentionPolicyForMode,
  isFailedWebhookPayloadRetentionExpired,
  parsePositiveInteger,
  parseRetentionMode,
  parseRetentionWindowDays,
  RETENTION_POLICY,
  RETENTION_POLICY_VERSION,
  RETENTION_WINDOWS,
} from "@/lib/retention-policy";

describe("retention policy", () => {
  it("encodes the accepted baseline defaults", () => {
    assert.deepEqual(RETENTION_WINDOWS, {
      auditCoreYears: 7,
      auditDetails: 180,
      acceptedConsentCoreAfterSubscriptionYears: 7,
      acceptedConsentClientDataMonths: 12,
      processedWebhookPayload: 180,
      failedWebhookPayloadAfterResolutionYears: 1,
      testOperationalData: 90,
      genericMetadata: 180,
    });
    assert.equal(RETENTION_POLICY.length, 8);
    assert.equal(RETENTION_POLICY_VERSION, "2026-06-18");
    assert.equal(
      RETENTION_POLICY.find((record) => record.dataArea === "accepted-consent-core")
        ?.windowLabel,
      "Subscription lifetime + 7 years",
    );
  });

  it("parses safe report defaults and explicit modes", () => {
    assert.equal(parseRetentionMode(undefined), "all");
    assert.equal(parseRetentionMode("", "live"), "live");
    assert.equal(parseRetentionMode("live"), "live");
    assert.equal(parseRetentionMode("test"), "test");
    assert.throws(() => parseRetentionMode("production"), /live, test, all/);
  });

  it("keeps live and test-only policy records separated", () => {
    const liveAreas = getRetentionPolicyForMode("live").map(
      (record) => record.dataArea,
    );
    const testAreas = getRetentionPolicyForMode("test").map(
      (record) => record.dataArea,
    );

    assert.equal(liveAreas.includes("test-operational-data"), false);
    assert.equal(testAreas.includes("test-operational-data"), true);
    assert.equal(getRetentionPolicyForMode("all").length, RETENTION_POLICY.length);
  });

  it("accepts only positive safe integers for windows", () => {
    assert.equal(parsePositiveInteger("180", "days"), 180);
    assert.equal(parsePositiveInteger(90, "days"), 90);
    assert.equal(parseRetentionWindowDays(undefined, 180), 180);

    for (const value of [0, -1, 1.5, "0", "-1", "1.5", "12days", " 12", NaN]) {
      assert.throws(() => parsePositiveInteger(value, "days"), /positive integer/);
    }
    assert.throws(
      () => parsePositiveInteger(String(Number.MAX_SAFE_INTEGER + 1), "days"),
      /positive integer/,
    );
  });

  it("preserves unresolved failed webhook payloads regardless of age", () => {
    const asOf = new Date("2036-01-01T00:00:00.000Z");

    assert.equal(
      isFailedWebhookPayloadRetentionExpired({ resolvedAt: null, asOf }),
      false,
    );
  });

  it("starts failed webhook retention at resolution", () => {
    const resolvedAt = new Date("2025-01-01T00:00:00.000Z");

    assert.equal(
      isFailedWebhookPayloadRetentionExpired({
        resolvedAt,
        asOf: new Date("2025-12-31T23:59:59.999Z"),
      }),
      false,
    );
    assert.equal(
      isFailedWebhookPayloadRetentionExpired({
        resolvedAt,
        asOf: new Date("2026-01-01T00:00:00.000Z"),
      }),
      true,
    );
  });
});
