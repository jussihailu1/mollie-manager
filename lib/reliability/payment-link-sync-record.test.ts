import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildPaymentLinkSyncMetadata,
  derivePaymentLinkSyncAmount,
  derivePaymentLinkSyncStatus,
} from "@/lib/reliability/payment-link-sync-record";

describe("payment link sync record helpers", () => {
  it("derives local payment-link status from Mollie link and latest payments", () => {
    assert.equal(
      derivePaymentLinkSyncStatus(
        { archived: true, paidAt: "2026-06-08T10:00:00Z", sequenceType: "first" },
        [],
      ),
      "archived",
    );
    assert.equal(
      derivePaymentLinkSyncStatus(
        { archived: false, sequenceType: "first" },
        [{ id: "tr_paid", status: "paid" }],
      ),
      "paid",
    );
    assert.equal(
      derivePaymentLinkSyncStatus(
        { archived: false, sequenceType: "first" },
        [{ id: "tr_failed", status: "failed" }],
      ),
      "failed",
    );
    assert.equal(
      derivePaymentLinkSyncStatus(
        { archived: false, sequenceType: "first" },
        [{ id: "tr_open", status: "open" }],
      ),
      "open",
    );
  });

  it("uses Mollie amount, then minimum amount, then latest payment amount", () => {
    assert.deepEqual(
      derivePaymentLinkSyncAmount(
        {
          amount: { currency: "EUR", value: "20.00" },
          archived: false,
          minimumAmount: { currency: "EUR", value: "10.00" },
          sequenceType: "first",
        },
        [{ amount: { currency: "EUR", value: "5.00" }, id: "tr_1", status: "open" }],
      ),
      { currency: "EUR", value: "20.00" },
    );
    assert.deepEqual(
      derivePaymentLinkSyncAmount(
        {
          archived: false,
          minimumAmount: { currency: "EUR", value: "10.00" },
          sequenceType: "first",
        },
        [{ amount: { currency: "EUR", value: "5.00" }, id: "tr_1", status: "open" }],
      ),
      { currency: "EUR", value: "10.00" },
    );
    assert.deepEqual(
      derivePaymentLinkSyncAmount(
        { archived: false, sequenceType: "first" },
        [{ amount: { currency: "EUR", value: "5.00" }, id: "tr_1", status: "open" }],
      ),
      { currency: "EUR", value: "5.00" },
    );
    assert.deepEqual(
      derivePaymentLinkSyncAmount({ archived: false, sequenceType: "first" }, []),
      { currency: "EUR", value: "0.00" },
    );
  });

  it("builds metadata while preserving safe existing fields", () => {
    assert.deepEqual(
      buildPaymentLinkSyncMetadata({
        existingMetadata: {
          customField: "keep",
          redirectUrl: "https://app.test/existing",
        },
        paymentLink: {
          archived: false,
          customerId: "cst_test",
          reusable: null,
          sequenceType: "first",
        },
        payments: [
          { id: "tr_latest", status: "open" },
          { id: "tr_old", status: "failed" },
        ],
      }),
      {
        allowedMethods: ["ideal"],
        customField: "keep",
        latestPaymentId: "tr_latest",
        latestPaymentStatus: "open",
        mollieCustomerId: "cst_test",
        paymentIds: ["tr_latest", "tr_old"],
        paymentType: "first",
        redirectUrl: "https://app.test/existing",
        reusable: false,
        sequenceType: "first",
        source: "subscription_onboarding",
      },
    );
  });
});
