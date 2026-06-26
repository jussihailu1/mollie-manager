import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  amsterdamDateStart,
  type CancellationRequestDependencies,
  type CancellationRequestSubscription,
  recordCancellationRequestWithDependencies,
  type SubscriptionOperationRequestStatus,
  transitionSubscriptionOperationRequestWithDependencies,
  type TransitionRequestDependencies,
  withdrawSubscriptionOperationRequestWithDependencies,
  type WithdrawalRequestDependencies,
} from "@/lib/subscription-operation-requests";

const baseSubscription = {
  cancellationEffect: "immediate",
  customerId: "customer_1",
  localStatus: "active",
  mollieStatus: "active",
  serviceEndAt: null,
  termMode: "open_ended",
} satisfies CancellationRequestSubscription;

const baseInput = {
  mode: "test",
  operatorReason: "Customer requested cancellation by email.",
  paidPeriodEndDate: "2026-07-31",
  requestedByEmail: "operator@example.test",
  requestedEffectiveDate: "2026-07-01",
  subscriptionId: "25d0e521-9079-4d82-8397-b5e87d8255b1",
} as const;

function createDependencies(options: {
  inserted?: boolean;
  subscription?: CancellationRequestSubscription | null;
} = {}) {
  const events: string[] = [];
  const inserts: Record<string, unknown>[] = [];
  const audits: Record<string, unknown>[] = [];
  const dependencies: CancellationRequestDependencies = {
    createId: () => "request_1",
    now: () => new Date("2026-07-01T10:00:00.000Z"),
    async runInTransaction(callback) {
      events.push("transaction:start");
      const result = await callback({
        async insertPendingRequest(input) {
          events.push("insert");
          inserts.push(input);
          return options.inserted ?? true;
        },
        async lockSubscription() {
          events.push("lock");
          return options.subscription === undefined
            ? baseSubscription
            : options.subscription;
        },
        async writeAudit(input) {
          events.push("audit");
          audits.push(input);
        },
      });
      events.push("transaction:end");
      return result;
    },
  };

  return { audits, dependencies, events, inserts };
}

function createWithdrawalDependencies(options: {
  request?:
    | {
        customerId: string;
        id: string;
        operation: "cancel" | "pause" | "resume";
        status: SubscriptionOperationRequestStatus;
        subscriptionId: string;
      }
    | null;
  updated?: boolean;
} = {}) {
  const audits: Record<string, unknown>[] = [];
  const events: string[] = [];
  const dependencies: WithdrawalRequestDependencies = {
    async runInTransaction(callback) {
      events.push("transaction:start");
      const result = await callback({
        async lockOperationRequest() {
          events.push("lock");
          return (
            options.request ?? {
              customerId: "customer_1",
              id: "request_1",
              operation: "cancel",
              status: "pending",
              subscriptionId: baseInput.subscriptionId,
            }
          );
        },
        async markWithdrawn() {
          events.push("withdraw");
          return options.updated ?? true;
        },
        async writeAudit(input) {
          events.push("audit");
          audits.push(input);
        },
      });
      events.push("transaction:end");
      return result;
    },
  };

  return { audits, dependencies, events };
}

function createTransitionDependencies(options: {
  request?:
    | {
        customerId: string;
        id: string;
        operation: "cancel" | "pause" | "resume";
        status: SubscriptionOperationRequestStatus;
        subscriptionId: string;
      }
    | null;
  updated?: boolean;
} = {}) {
  const audits: Record<string, unknown>[] = [];
  const events: string[] = [];
  const dependencies: TransitionRequestDependencies = {
    async runInTransaction(callback) {
      events.push("transaction:start");
      const result = await callback({
        async lockOperationRequest() {
          events.push("lock");
          return (
            options.request ?? {
              customerId: "customer_1",
              id: "request_1",
              operation: "cancel",
              status: "pending",
              subscriptionId: baseInput.subscriptionId,
            }
          );
        },
        async updateStatus(input) {
          events.push(`update:${input.previousStatus}->${input.nextStatus}`);
          return options.updated ?? true;
        },
        async writeAudit(input) {
          events.push("audit");
          audits.push(input);
        },
      });
      events.push("transaction:end");
      return result;
    },
  };

  return { audits, dependencies, events };
}

describe("Amsterdam date normalization", () => {
  it("uses the pre-transition offset at Amsterdam midnight", () => {
    assert.equal(amsterdamDateStart("2026-03-29"), "2026-03-28T23:00:00.000Z");
    assert.equal(amsterdamDateStart("2026-10-25"), "2026-10-24T22:00:00.000Z");
  });

  it("rejects non-strict and impossible dates", () => {
    for (const value of ["2026-7-01", "2026-02-29", " 2026-07-01"]) {
      assert.throws(() => amsterdamDateStart(value));
    }
  });
});

describe("cancellation request recording", () => {
  it("records allowed intent, forces immediate paid-period null, then audits", async () => {
    const context = createDependencies();
    const result = await recordCancellationRequestWithDependencies(
      baseInput,
      context.dependencies,
    );

    assert.deepEqual(result, { customerId: "customer_1", status: "recorded" });
    assert.equal(context.inserts[0]?.paidPeriodEndAt, null);
    assert.equal(
      context.inserts[0]?.requestedEffectiveAt,
      "2026-06-30T22:00:00.000Z",
    );
    assert.deepEqual(context.events, [
      "transaction:start",
      "lock",
      "insert",
      "audit",
      "transaction:end",
    ]);

    const auditJson = JSON.stringify(context.audits[0]);
    assert.match(auditJson, /"providerChangeOccurred":false/);
    assert.match(
      auditJson,
      /"providerMutationRequirement":"cancel_provider_subscription_now"/,
    );
    assert.doesNotMatch(auditJson, /Customer requested|operator@example\.test/);
  });

  it("denies paid-period intent without a valid paid-period end", async () => {
    const context = createDependencies({
      subscription: {
        ...baseSubscription,
        cancellationEffect: "end_of_paid_period",
      },
    });
    const result = await recordCancellationRequestWithDependencies(
      { ...baseInput, paidPeriodEndDate: undefined },
      context.dependencies,
    );

    assert.deepEqual(result, { customerId: "customer_1", status: "denied" });
    assert.deepEqual(context.events, [
      "transaction:start",
      "lock",
      "transaction:end",
    ]);
    assert.equal(context.inserts.length, 0);
    assert.equal(context.audits.length, 0);
  });

  it("returns duplicate for an unresolved existing request without auditing", async () => {
    const context = createDependencies({ inserted: false });
    const result = await recordCancellationRequestWithDependencies(
      baseInput,
      context.dependencies,
    );

    assert.deepEqual(result, { customerId: "customer_1", status: "duplicate" });
    assert.deepEqual(context.events, [
      "transaction:start",
      "lock",
      "insert",
      "transaction:end",
    ]);
    assert.equal(context.audits.length, 0);
  });
});

describe("subscription operation request withdrawal", () => {
  it("withdraws unresolved intent, then audits without provider data", async () => {
    const context = createWithdrawalDependencies();
    const result = await withdrawSubscriptionOperationRequestWithDependencies(
      {
        mode: "test",
        operationRequestId: "request_1",
      },
      context.dependencies,
    );

    assert.deepEqual(result, {
      customerId: "customer_1",
      operation: "cancel",
      status: "withdrawn",
    });
    assert.deepEqual(context.events, [
      "transaction:start",
      "lock",
      "withdraw",
      "audit",
      "transaction:end",
    ]);
    assert.match(JSON.stringify(context.audits[0]), /"providerChangeOccurred":false/);
    assert.doesNotMatch(JSON.stringify(context.audits[0]), /requestedByEmail|operatorReason/);
  });

  it("rejects already terminal requests without mutating or auditing", async () => {
    const context = createWithdrawalDependencies({
      request: {
        customerId: "customer_1",
        id: "request_1",
        operation: "cancel",
        status: "withdrawn",
        subscriptionId: baseInput.subscriptionId,
      },
    });
    const result = await withdrawSubscriptionOperationRequestWithDependencies(
      {
        mode: "test",
        operationRequestId: "request_1",
      },
      context.dependencies,
    );

    assert.deepEqual(result, {
      customerId: "customer_1",
      operation: "cancel",
      requestStatus: "withdrawn",
      status: "not_withdrawable",
    });
    assert.deepEqual(context.events, ["transaction:start", "lock", "transaction:end"]);
    assert.equal(context.audits.length, 0);
  });
});

describe("subscription operation request transitions", () => {
  it("moves pending request to scheduled with audit only", async () => {
    const context = createTransitionDependencies();
    const result = await transitionSubscriptionOperationRequestWithDependencies(
      {
        mode: "test",
        operationRequestId: "request_1",
        targetStatus: "scheduled",
      },
      context.dependencies,
    );

    assert.deepEqual(result, {
      customerId: "customer_1",
      operation: "cancel",
      status: "transitioned",
      targetStatus: "scheduled",
    });
    assert.deepEqual(context.events, [
      "transaction:start",
      "lock",
      "update:pending->scheduled",
      "audit",
      "transaction:end",
    ]);
    assert.match(JSON.stringify(context.audits[0]), /"nextStatus":"scheduled"/);
    assert.doesNotMatch(JSON.stringify(context.audits[0]), /requestedByEmail|operatorReason/);
  });

  it("denies unsupported unresolved transition without mutating", async () => {
    const context = createTransitionDependencies({
      request: {
        customerId: "customer_1",
        id: "request_1",
        operation: "cancel",
        status: "scheduled",
        subscriptionId: baseInput.subscriptionId,
      },
    });
    const result = await transitionSubscriptionOperationRequestWithDependencies(
      {
        mode: "test",
        operationRequestId: "request_1",
        targetStatus: "scheduled",
      },
      context.dependencies,
    );

    assert.deepEqual(result, {
      customerId: "customer_1",
      operation: "cancel",
      requestStatus: "scheduled",
      status: "transition_denied",
      targetStatus: "scheduled",
    });
    assert.deepEqual(context.events, ["transaction:start", "lock", "transaction:end"]);
    assert.equal(context.audits.length, 0);
  });
});
