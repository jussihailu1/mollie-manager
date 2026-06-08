import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildSubscriptionSyncMetadata,
  deriveSubscriptionBillingDay,
  shouldStopSubscriptionAfterCurrentPeriod,
} from "@/lib/reliability/subscription-sync-record";

describe("subscription sync record helpers", () => {
  it("derives billing day from Mollie start date in UTC", () => {
    assert.equal(
      deriveSubscriptionBillingDay({
        startDate: "2026-06-09",
        status: "active",
      }),
      9,
    );
    assert.equal(deriveSubscriptionBillingDay({ status: "active" }), null);
  });

  it("marks terminal Mollie statuses as stop-after-current-period", () => {
    assert.equal(
      shouldStopSubscriptionAfterCurrentPeriod({ status: "canceled" }),
      true,
    );
    assert.equal(
      shouldStopSubscriptionAfterCurrentPeriod({ status: "completed" }),
      true,
    );
    assert.equal(
      shouldStopSubscriptionAfterCurrentPeriod({ status: "active" }),
      false,
    );
  });

  it("builds persisted metadata with explicit null for missing next payment date", () => {
    assert.deepEqual(
      buildSubscriptionSyncMetadata({
        nextPaymentDate: "2026-07-09",
        status: "active",
      }),
      { nextPaymentDate: "2026-07-09" },
    );
    assert.deepEqual(buildSubscriptionSyncMetadata({ status: "active" }), {
      nextPaymentDate: null,
    });
  });
});
