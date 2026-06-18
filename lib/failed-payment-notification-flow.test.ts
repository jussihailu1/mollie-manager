import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  runFailedPaymentNotificationFlow,
  type FailedPaymentNotificationContext,
  type FailedPaymentNotificationDependencies,
} from "@/lib/failed-payment-notification-flow";
import { classifyPaymentOutcome } from "@/lib/payment-outcome-classification";

function buildContext(
  overrides?: Partial<FailedPaymentNotificationContext>,
): FailedPaymentNotificationContext {
  return {
    amountCurrency: "EUR",
    amountValue: "49.99",
    contactEmail: "billing@example.com",
    customerEmail: "customer@example.com",
    customerId: "customer_123",
    customerName: "Ada BV",
    invoiceNumber: "INV-001",
    localPaymentId: "payment_123",
    mode: "test",
    molliePaymentId: "tr_123",
    outcome: classifyPaymentOutcome({
      flowKind: "recurring",
      status: "failed",
    }),
    plannedCollectionDate: "2026-06-18",
    subscriptionId: "subscription_123",
    ...overrides,
  };
}

function buildDependencies(events: string[] = []): FailedPaymentNotificationDependencies {
  return {
    claimCustomerNotification: async () => {
      events.push("claim");
      return {
        id: "notification_123",
        isClaimed: true,
      };
    },
    markCustomerNotificationFailed: async () => {
      events.push("mark_failed");
    },
    markCustomerNotificationSent: async () => {
      events.push("mark_sent");
    },
    openOperatorTask: async () => {
      events.push("open_task");
      return {
        id: "alert_123",
        isNew: true,
      };
    },
    sendCustomerEmail: async () => {
      events.push("send");
    },
    writeAudit: async (input) => {
      events.push(`audit:${input.action}`);
    },
  };
}

describe("failed payment notification flow", () => {
  it("does nothing for non-review outcomes", async () => {
    const events: string[] = [];
    const result = await runFailedPaymentNotificationFlow(
      buildContext({
        outcome: classifyPaymentOutcome({
          flowKind: "recurring",
          status: "paid",
        }),
      }),
      buildDependencies(events),
    );

    assert.deepEqual(result, {
      customerEmailSent: false,
      customerNotificationClaimed: false,
      operatorTaskId: null,
    });
    assert.deepEqual(events, []);
  });

  it("opens operator task and claim-before-sends customer notification", async () => {
    const events: string[] = [];
    const result = await runFailedPaymentNotificationFlow(
      buildContext(),
      buildDependencies(events),
    );

    assert.deepEqual(result, {
      customerEmailSent: true,
      customerNotificationClaimed: true,
      operatorTaskId: "alert_123",
    });
    assert.deepEqual(events, [
      "open_task",
      "claim",
      "send",
      "mark_sent",
      "audit:failed_payment.notification.sent",
    ]);
  });

  it("does not send when notification claim already exists", async () => {
    const events: string[] = [];
    const dependencies = buildDependencies(events);
    dependencies.claimCustomerNotification = async () => {
      events.push("claim");
      return {
        id: "notification_123",
        isClaimed: false,
      };
    };

    const result = await runFailedPaymentNotificationFlow(
      buildContext(),
      dependencies,
    );

    assert.deepEqual(result, {
      customerEmailSent: false,
      customerNotificationClaimed: false,
      operatorTaskId: "alert_123",
    });
    assert.deepEqual(events, ["open_task", "claim"]);
  });

  it("opens operator task but skips customer email without recipient", async () => {
    const events: string[] = [];
    const result = await runFailedPaymentNotificationFlow(
      buildContext({
        customerEmail: null,
      }),
      buildDependencies(events),
    );

    assert.deepEqual(result, {
      customerEmailSent: false,
      customerNotificationClaimed: false,
      operatorTaskId: "alert_123",
    });
    assert.deepEqual(events, [
      "open_task",
      "audit:failed_payment.notification.skipped",
    ]);
  });

  it("marks claimed notification failed and audits without leaking error details", async () => {
    const events: string[] = [];
    const dependencies = buildDependencies(events);
    dependencies.sendCustomerEmail = async () => {
      events.push("send");
      throw new Error("smtp password rejected");
    };

    await assert.rejects(
      runFailedPaymentNotificationFlow(buildContext(), dependencies),
      /smtp password rejected/,
    );
    assert.deepEqual(events, [
      "open_task",
      "claim",
      "send",
      "mark_failed",
      "audit:failed_payment.notification.failed",
    ]);
  });
});

