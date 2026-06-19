import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const source = readFileSync("lib/customer-activity-timeline.ts", "utf8");

describe("customer activity timeline source", () => {
  it("defines stable customer timeline item types across the required sources", () => {
    for (const itemType of [
      "alert_opened",
      "audit_event",
      "customer_created",
      "failed_payment_notification",
      "first_payment_invoice",
      "payment_status",
      "recurring_invoice",
      "subscription_consent",
      "subscription_status",
    ]) {
      assert.match(source, new RegExp(`['"]${itemType}['"]`));
    }

    assert.match(source, /from audit_logs al/);
    assert.match(source, /from alerts a/);
    assert.match(source, /from payments p/);
    assert.match(source, /from recurring_billing_schedules rbs/);
    assert.match(source, /from subscription_onboarding_consents soc/);
    assert.match(source, /from customer_payment_notifications cpn/);
  });

  it("keeps raw sensitive stores out of timeline output", () => {
    assert.doesNotMatch(source, /\bdetails\b/i);
    assert.doesNotMatch(source, /\bpayload\b/i);
    assert.doesNotMatch(source, /\bmetadata\b/i);
    assert.doesNotMatch(source, /accepted_ip|accepted_user_agent|consent_token/i);
    assert.doesNotMatch(source, /authorization|secret/i);
  });
});
