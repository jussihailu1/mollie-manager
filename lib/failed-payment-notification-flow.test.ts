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
        claimToken: "claim_123",
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
    notificationsAreConfigured: () => true,
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
        claimToken: null,
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

  it("opens operator task but does not claim or send when email is unconfigured", async () => {
    const events: string[] = [];
    const dependencies = buildDependencies(events);
    dependencies.notificationsAreConfigured = () => false;

    const result = await runFailedPaymentNotificationFlow(
      buildContext(),
      dependencies,
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

  it("opens one durable operator task for duplicate actionable outcomes", async () => {
    const events: string[] = [];
    const dependencies = buildDependencies(events);
    let durableAlertId: string | null = null;
    let alertsCreated = 0;

    dependencies.notificationsAreConfigured = () => false;
    dependencies.openOperatorTask = async () => {
      events.push("open_task");
      if (!durableAlertId) {
        durableAlertId = "alert_123";
        alertsCreated += 1;
      }
      return {
        id: durableAlertId,
        isNew: alertsCreated === 1 && events.length === 1,
      };
    };

    const first = await runFailedPaymentNotificationFlow(
      buildContext(),
      dependencies,
    );
    const duplicate = await runFailedPaymentNotificationFlow(
      buildContext(),
      dependencies,
    );

    assert.equal(alertsCreated, 1);
    assert.equal(first.operatorTaskId, "alert_123");
    assert.equal(duplicate.operatorTaskId, "alert_123");
    assert.deepEqual(events, [
      "open_task",
      "audit:failed_payment.notification.skipped",
      "open_task",
      "audit:failed_payment.notification.skipped",
    ]);
  });

  for (const input of [
    { flowKind: "recurring" as const, status: "failed" },
    { flowKind: "recurring" as const, status: "reversed" },
    { flowKind: "recurring" as const, status: "charged_back" },
    { flowKind: "mandate_only" as const, status: "failed" },
  ]) {
    it(`opens an operator task for ${input.status} ${input.flowKind}`, async () => {
      const events: string[] = [];
      const dependencies = buildDependencies(events);
      dependencies.notificationsAreConfigured = () => false;

      const result = await runFailedPaymentNotificationFlow(
        buildContext({ outcome: classifyPaymentOutcome(input) }),
        dependencies,
      );

      assert.equal(result.operatorTaskId, "alert_123");
      assert.deepEqual(events, [
        "open_task",
        "audit:failed_payment.notification.skipped",
      ]);
    });
  }

  for (const status of ["paid", "pending"] as const) {
    it(`does nothing for ${status} outcomes even when email is configured`, async () => {
      const events: string[] = [];

      const result = await runFailedPaymentNotificationFlow(
        buildContext({
          outcome: classifyPaymentOutcome({
            flowKind: "recurring",
            status,
          }),
        }),
        buildDependencies(events),
      );

      assert.equal(result.operatorTaskId, null);
      assert.deepEqual(events, []);
    });
  }

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
