import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildAlertEmailContent,
  type AlertEmailContext,
} from "@/lib/reliability/alert-email-template";

function buildContext(overrides?: Partial<AlertEmailContext>): AlertEmailContext {
  return {
    alertId: "alert_123",
    createdAt: "2026-05-08T10:00:00.000Z",
    customerEmail: "ops@example.com",
    customerId: "customer_123",
    customerName: "Acme BV",
    message: "A payment failed and needs review.",
    mode: "test",
    paymentAmountCurrency: "EUR",
    paymentAmountValue: "49.99",
    paymentId: "payment_123",
    paymentMollieId: "tr_abc123",
    paymentStatus: "failed",
    severity: "warning",
    subscriptionId: "subscription_123",
    subscriptionLocalStatus: "payment_action_required",
    subscriptionMollieId: "sub_abc123",
    subscriptionStatus: "suspended",
    title: "Failed payment",
    ...overrides,
  };
}

describe("alert email composer", () => {
  it("uses payment as primary link and includes related links", () => {
    const email = buildAlertEmailContent(
      buildContext(),
      "https://manager.example.com",
    );

    assert.equal(
      email.primaryUrl,
      "https://manager.example.com/payments?focus=payment_123",
    );
    assert.deepEqual(
      email.relatedLinks.map((link) => link.url),
      [
        "https://manager.example.com/customers?focus=customer_123",
        "https://manager.example.com/notifications",
      ],
    );
  });

  it("falls back to customer link when payment is not available", () => {
    const email = buildAlertEmailContent(
      buildContext({
        paymentId: null,
      }),
      "https://manager.example.com",
    );

    assert.equal(
      email.primaryUrl,
      "https://manager.example.com/customers?focus=customer_123",
    );
    assert.equal(email.relatedLinks[0]?.url, "https://manager.example.com/notifications");
  });

  it("includes safe details and text output with actionable link", () => {
    const email = buildAlertEmailContent(
      buildContext(),
      "https://manager.example.com",
    );

    assert.match(email.html, /Safe details/i);
    assert.match(email.html, /Mollie payment ID/i);
    assert.match(email.html, /tr_abc123/);
    assert.match(email.text, /Open in Mollie Manager: https:\/\/manager\.example\.com\/payments\?focus=payment_123/);
    assert.match(email.text, /Safe details:/);
  });

  it("does not render payload-like sensitive fields", () => {
    const context = {
      ...buildContext(),
      payload: {
        SMTP_PASSWORD: "super-secret",
        MOLLIE_WEBHOOK_SHARED_SECRET: "another-secret",
      },
    } as AlertEmailContext;
    const email = buildAlertEmailContent(context, "https://manager.example.com");

    assert.doesNotMatch(email.html, /SMTP_PASSWORD/);
    assert.doesNotMatch(email.html, /MOLLIE_WEBHOOK_SHARED_SECRET/);
    assert.doesNotMatch(email.html, /super-secret/);
    assert.doesNotMatch(email.text, /super-secret/);
  });
});
