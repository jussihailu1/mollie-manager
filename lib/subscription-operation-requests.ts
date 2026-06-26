import type { MollieMode } from "@/lib/env";
import {
  decideSubscriptionOperation,
  type LocalSubscriptionStatus,
  type ProviderSubscriptionStatus,
  type SubscriptionOperationPolicyDecision,
} from "@/lib/subscription-operation-policy";
import type {
  CancellationEffect,
  SubscriptionTermMode,
} from "@/lib/subscription-policy";

const AMSTERDAM_TIME_ZONE = "Europe/Amsterdam";
const strictDatePattern = /^\d{4}-\d{2}-\d{2}$/;

export type CancellationRequestSubscription = {
  cancellationEffect: CancellationEffect;
  customerId: string;
  localStatus: LocalSubscriptionStatus;
  mollieStatus: ProviderSubscriptionStatus | null;
  serviceEndAt: string | null;
  termMode: SubscriptionTermMode;
};

type CancellationRequestInsert = {
  cancellationEffect: CancellationEffect;
  id: string;
  mode: MollieMode;
  operatorReason: string;
  paidPeriodEndAt: string | null;
  policyReasonCode: string;
  providerMutationRequirement: string;
  requestedByEmail: string;
  requestedEffectiveAt: string;
  subscriptionId: string;
};

type CancellationRequestAudit = {
  cancellationEffect: CancellationEffect;
  operationRequestId: string;
  paidPeriodEndAt: string | null;
  policyReasonCode: string;
  providerChangeOccurred: false;
  providerMutationRequirement: string;
  requestedEffectiveAt: string;
  subscriptionId: string;
};

export type SubscriptionOperationRequestStatus =
  | "applied"
  | "failed"
  | "pending"
  | "processing"
  | "scheduled"
  | "withdrawn";

export type WithdrawableOperationRequest = {
  customerId: string;
  id: string;
  operation: "cancel" | "pause" | "resume";
  status: SubscriptionOperationRequestStatus;
  subscriptionId: string;
};

type WithdrawalRequestAudit = {
  operation: "cancel" | "pause" | "resume";
  operationRequestId: string;
  previousStatus: "pending" | "processing" | "scheduled";
  providerChangeOccurred: false;
  subscriptionId: string;
};

type TransitionRequestAudit = {
  nextStatus: "processing" | "scheduled";
  operation: "cancel" | "pause" | "resume";
  operationRequestId: string;
  previousStatus: "pending" | "processing" | "scheduled";
  providerChangeOccurred: false;
  subscriptionId: string;
};

export type CancellationRequestTransaction = {
  insertPendingRequest: (input: CancellationRequestInsert) => Promise<boolean>;
  lockSubscription: (input: {
    mode: MollieMode;
    subscriptionId: string;
  }) => Promise<CancellationRequestSubscription | null>;
  writeAudit: (input: CancellationRequestAudit) => Promise<void>;
};

export type WithdrawalRequestTransaction = {
  lockOperationRequest: (input: {
    mode: MollieMode;
    operationRequestId: string;
  }) => Promise<WithdrawableOperationRequest | null>;
  markWithdrawn: (input: { operationRequestId: string }) => Promise<boolean>;
  writeAudit: (input: WithdrawalRequestAudit) => Promise<void>;
};

export type TransitionRequestTransaction = {
  lockOperationRequest: (input: {
    mode: MollieMode;
    operationRequestId: string;
  }) => Promise<WithdrawableOperationRequest | null>;
  updateStatus: (input: {
    nextStatus: "processing" | "scheduled";
    operationRequestId: string;
    previousStatus: "pending" | "processing" | "scheduled";
  }) => Promise<boolean>;
  writeAudit: (input: TransitionRequestAudit) => Promise<void>;
};

export type CancellationRequestDependencies = {
  createId: () => string;
  now: () => Date;
  runInTransaction: <T>(
      callback: (transaction: CancellationRequestTransaction) => Promise<T>,
  ) => Promise<T>;
};

export type WithdrawalRequestDependencies = {
  runInTransaction: <T>(
    callback: (transaction: WithdrawalRequestTransaction) => Promise<T>,
  ) => Promise<T>;
};

export type TransitionRequestDependencies = {
  runInTransaction: <T>(
    callback: (transaction: TransitionRequestTransaction) => Promise<T>,
  ) => Promise<T>;
};

export type RecordCancellationRequestInput = {
  mode: MollieMode;
  operatorReason: string;
  paidPeriodEndDate?: string;
  requestedByEmail: string;
  requestedEffectiveDate: string;
  subscriptionId: string;
};

export type RecordCancellationRequestResult =
  | { status: "not_found" }
  | { customerId: string; status: "denied" }
  | { customerId: string; status: "duplicate" }
  | { customerId: string; status: "recorded" };

export type WithdrawSubscriptionOperationRequestResult =
  | { status: "not_found" }
  | {
      customerId: string;
      operation: "cancel" | "pause" | "resume";
      requestStatus: "applied" | "failed" | "withdrawn";
      status: "not_withdrawable";
    }
  | {
      customerId: string;
      operation: "cancel" | "pause" | "resume";
      status: "withdrawn";
    };

export type TransitionSubscriptionOperationRequestResult =
  | { status: "not_found" }
  | {
      customerId: string;
      operation: "cancel" | "pause" | "resume";
      requestStatus: "applied" | "failed" | "withdrawn";
      status: "not_transitionable";
    }
  | {
      customerId: string;
      operation: "cancel" | "pause" | "resume";
      requestStatus: "pending" | "processing" | "scheduled";
      status: "transition_denied";
      targetStatus: "processing" | "scheduled";
    }
  | {
      customerId: string;
      operation: "cancel" | "pause" | "resume";
      status: "transitioned";
      targetStatus: "processing" | "scheduled";
    };

function canTransitionRequestStatus(
  previousStatus: "pending" | "processing" | "scheduled",
  nextStatus: "processing" | "scheduled",
) {
  if (previousStatus === "pending") {
    return nextStatus === "processing" || nextStatus === "scheduled";
  }

  if (previousStatus === "scheduled") {
    return nextStatus === "processing";
  }

  return nextStatus === "scheduled";
}

function getDateParts(value: string) {
  if (!strictDatePattern.test(value)) {
    return null;
  }

  const [year, month, day] = value.split("-").map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));

  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }

  return { day, month, year };
}

function getAmsterdamOffsetMilliseconds(utcDate: Date) {
  const offsetName = new Intl.DateTimeFormat("en-US", {
    timeZone: AMSTERDAM_TIME_ZONE,
    timeZoneName: "longOffset",
  })
    .formatToParts(utcDate)
    .find((part) => part.type === "timeZoneName")?.value;
  const match = offsetName?.match(/^GMT([+-])(\d{2}):(\d{2})$/);

  if (!match) {
    throw new Error("Could not resolve the Europe/Amsterdam UTC offset.");
  }

  const direction = match[1] === "+" ? 1 : -1;
  return direction * (Number(match[2]) * 60 + Number(match[3])) * 60_000;
}

export function amsterdamDateStart(value: string) {
  const parts = getDateParts(value);

  if (!parts) {
    throw new Error("Date must be a valid YYYY-MM-DD value.");
  }

  const utcMidnight = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  return new Date(
    utcMidnight.getTime() - getAmsterdamOffsetMilliseconds(utcMidnight),
  ).toISOString();
}

export function getAmsterdamDate(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: AMSTERDAM_TIME_ZONE,
    year: "numeric",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return `${values.year}-${values.month}-${values.day}`;
}

function cancellationPolicyDecision(input: {
  now: Date;
  operatorReason: string;
  paidPeriodEndAt: string | null;
  requestedEffectiveAt: string;
  subscription: CancellationRequestSubscription;
}): SubscriptionOperationPolicyDecision {
  return decideSubscriptionOperation({
    asOf: amsterdamDateStart(getAmsterdamDate(input.now)),
    cancellationEffect: input.subscription.cancellationEffect,
    localStatus: input.subscription.localStatus,
    operation: "cancel",
    operatorReason: input.operatorReason,
    paidPeriodEndAt: input.paidPeriodEndAt,
    providerStatus: input.subscription.mollieStatus as ProviderSubscriptionStatus,
    requestedEffectiveAt: input.requestedEffectiveAt,
    serviceEndAt: input.subscription.serviceEndAt,
    termMode: input.subscription.termMode,
  });
}

export async function recordCancellationRequestWithDependencies(
  input: RecordCancellationRequestInput,
  dependencies: CancellationRequestDependencies,
): Promise<RecordCancellationRequestResult> {
  return dependencies.runInTransaction(async (transaction) => {
    const subscription = await transaction.lockSubscription({
      mode: input.mode,
      subscriptionId: input.subscriptionId,
    });

    if (!subscription) {
      return { status: "not_found" };
    }

    const requestedEffectiveAt = amsterdamDateStart(input.requestedEffectiveDate);
    const paidPeriodEndAt =
      subscription.cancellationEffect === "immediate"
        ? null
        : input.paidPeriodEndDate
          ? amsterdamDateStart(input.paidPeriodEndDate)
          : null;
    const decision = cancellationPolicyDecision({
      now: dependencies.now(),
      operatorReason: input.operatorReason,
      paidPeriodEndAt,
      requestedEffectiveAt,
      subscription,
    });

    if (!decision.allowed) {
      return { customerId: subscription.customerId, status: "denied" };
    }

    const requestId = dependencies.createId();
    const inserted = await transaction.insertPendingRequest({
      cancellationEffect: subscription.cancellationEffect,
      id: requestId,
      mode: input.mode,
      operatorReason: input.operatorReason,
      paidPeriodEndAt,
      policyReasonCode: decision.reasonCode,
      providerMutationRequirement: decision.providerMutationRequirement,
      requestedByEmail: input.requestedByEmail,
      requestedEffectiveAt,
      subscriptionId: input.subscriptionId,
    });

    if (!inserted) {
      return { customerId: subscription.customerId, status: "duplicate" };
    }

    await transaction.writeAudit({
      cancellationEffect: subscription.cancellationEffect,
      operationRequestId: requestId,
      paidPeriodEndAt,
      policyReasonCode: decision.reasonCode,
      providerChangeOccurred: false,
      providerMutationRequirement: decision.providerMutationRequirement,
      requestedEffectiveAt,
      subscriptionId: input.subscriptionId,
    });

    return { customerId: subscription.customerId, status: "recorded" };
  });
}

export async function withdrawSubscriptionOperationRequestWithDependencies(
  input: {
    mode: MollieMode;
    operationRequestId: string;
  },
  dependencies: WithdrawalRequestDependencies,
): Promise<WithdrawSubscriptionOperationRequestResult> {
  return dependencies.runInTransaction(async (transaction) => {
    const request = await transaction.lockOperationRequest({
      mode: input.mode,
      operationRequestId: input.operationRequestId,
    });

    if (!request) {
      return { status: "not_found" };
    }

    if (
      request.status !== "pending" &&
      request.status !== "processing" &&
      request.status !== "scheduled"
    ) {
      return {
        customerId: request.customerId,
        operation: request.operation,
        requestStatus: request.status,
        status: "not_withdrawable",
      };
    }

    const updated = await transaction.markWithdrawn({
      operationRequestId: input.operationRequestId,
    });

    if (!updated) {
      return { status: "not_found" };
    }

    await transaction.writeAudit({
      operation: request.operation,
      operationRequestId: request.id,
      previousStatus: request.status,
      providerChangeOccurred: false,
      subscriptionId: request.subscriptionId,
    });

    return {
      customerId: request.customerId,
      operation: request.operation,
      status: "withdrawn",
    };
  });
}

export async function transitionSubscriptionOperationRequestWithDependencies(
  input: {
    mode: MollieMode;
    operationRequestId: string;
    targetStatus: "processing" | "scheduled";
  },
  dependencies: TransitionRequestDependencies,
): Promise<TransitionSubscriptionOperationRequestResult> {
  return dependencies.runInTransaction(async (transaction) => {
    const request = await transaction.lockOperationRequest({
      mode: input.mode,
      operationRequestId: input.operationRequestId,
    });

    if (!request) {
      return { status: "not_found" };
    }

    if (
      request.status !== "pending" &&
      request.status !== "processing" &&
      request.status !== "scheduled"
    ) {
      return {
        customerId: request.customerId,
        operation: request.operation,
        requestStatus: request.status,
        status: "not_transitionable",
      };
    }

    if (!canTransitionRequestStatus(request.status, input.targetStatus)) {
      return {
        customerId: request.customerId,
        operation: request.operation,
        requestStatus: request.status,
        status: "transition_denied",
        targetStatus: input.targetStatus,
      };
    }

    const updated = await transaction.updateStatus({
      nextStatus: input.targetStatus,
      operationRequestId: input.operationRequestId,
      previousStatus: request.status,
    });

    if (!updated) {
      return { status: "not_found" };
    }

    await transaction.writeAudit({
      nextStatus: input.targetStatus,
      operation: request.operation,
      operationRequestId: request.id,
      previousStatus: request.status,
      providerChangeOccurred: false,
      subscriptionId: request.subscriptionId,
    });

    return {
      customerId: request.customerId,
      operation: request.operation,
      status: "transitioned",
      targetStatus: input.targetStatus,
    };
  });
}
