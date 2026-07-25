"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { sql } from "drizzle-orm";
import { z } from "zod";

import { writeAuditLog } from "@/lib/audit";
import { requireViewerSession } from "@/lib/auth/session";
import { getSelectedMollieMode } from "@/lib/dashboard-mode";
import { transaction } from "@/lib/db";
import { syncSubscriptionByLocalId } from "@/lib/reliability/sync";
import {
  getManagedSubscription,
  lockCancellationRequestSubscription,
  lockManagedOperationRequest,
} from "@/lib/reliability/sync-resource-state";
import {
  amsterdamDateStart,
  recordCancellationRequestWithDependencies,
  transitionSubscriptionOperationRequestWithDependencies,
  withdrawSubscriptionOperationRequestWithDependencies,
} from "@/lib/subscription-operation-requests";
import {
  redirectWithMessage,
  serializeError,
} from "@/lib/operations/action-helpers";
import { getCurrentTenantSelectionForViewer } from "@/lib/tenant-context";
import { buildDrawerPath } from "@/lib/dashboard-drawer-route";

const manageSubscriptionSchema = z.object({
  returnTo: z.string().trim().startsWith("/").default("/customers"),
  subscriptionId: z.string().uuid(),
});

function isStrictCalendarDate(value: string) {
  try {
    amsterdamDateStart(value);
    return true;
  } catch {
    return false;
  }
}

const strictCalendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isStrictCalendarDate);

const cancellationRequestSchema = z
  .object({
    operatorReason: z.string().trim().min(1).max(1000),
    paidPeriodEndDate: z.preprocess(
      (value) => (value === "" ? undefined : value),
      strictCalendarDateSchema.optional(),
    ),
    requestedEffectiveDate: strictCalendarDateSchema,
    subscriptionId: z.string().uuid(),
  })
  .strict();

const withdrawOperationRequestSchema = z.object({
  operationRequestId: z.string().uuid(),
  returnTo: z.string().trim().startsWith("/").default("/customers"),
});

const transitionOperationRequestSchema = z.object({
  operationRequestId: z.string().uuid(),
  returnTo: z.string().trim().startsWith("/").default("/customers"),
  targetStatus: z.enum(["processing", "scheduled"]),
});

async function recordCancellationRequest(input: {
  mode: "live" | "test";
  operatorReason: string;
  paidPeriodEndDate?: string;
  requestedByEmail: string;
  requestedEffectiveDate: string;
  subscriptionId: string;
  tenantId: string;
}) {
  return recordCancellationRequestWithDependencies(input, {
    createId: () => crypto.randomUUID(),
    now: () => new Date(),
    runInTransaction: (callback) =>
      transaction(async (client) =>
        callback({
          insertPendingRequest: async (request) => {
            const result = await client.execute<{ id: string }>(sql`
              insert into subscription_operation_requests (
                id,
                tenant_id,
                mode,
                subscription_id,
                operation,
                status,
                operator_reason,
                requested_effective_at,
                paid_period_end_at,
                cancellation_effect,
                policy_reason_code,
                provider_mutation_requirement,
                requested_by_email
              ) values (
                ${request.id},
                ${input.tenantId},
                ${request.mode},
                ${request.subscriptionId},
                'cancel',
                'pending',
                ${request.operatorReason},
                ${request.requestedEffectiveAt}::timestamptz,
                ${request.paidPeriodEndAt}::timestamptz,
                ${request.cancellationEffect},
                ${request.policyReasonCode},
                ${request.providerMutationRequirement},
                ${request.requestedByEmail}
              )
              on conflict (tenant_id, subscription_id, operation)
                where status in ('pending', 'scheduled', 'processing')
              do nothing
              returning id
            `);

            return Boolean(result.rows[0]?.id);
          },
          lockSubscription: ({ mode, subscriptionId }) =>
            lockCancellationRequestSubscription(
              client,
              subscriptionId,
              mode,
              input.tenantId,
            ),
          writeAudit: (audit) =>
            writeAuditLog(
              {
                action: "subscription.cancellation_request.record",
                details: audit,
                entityId: audit.subscriptionId,
                entityType: "subscription",
                mode: input.mode,
                outcome: "success",
                summary:
                  "Recorded cancellation intent only; no provider change occurred.",
              },
              client,
              { email: input.requestedByEmail, kind: "user" },
            ),
        }),
      ),
  });
}

async function withdrawOperationRequest(input: {
  mode: "live" | "test";
  operationRequestId: string;
  requestedByEmail: string;
  tenantId: string;
}) {
  return withdrawSubscriptionOperationRequestWithDependencies(input, {
    runInTransaction: (callback) =>
      transaction(async (client) =>
        callback({
          lockOperationRequest: ({ mode, operationRequestId }) =>
            lockManagedOperationRequest(
              client,
              operationRequestId,
              mode,
              input.tenantId,
            ),
          markWithdrawn: async ({ operationRequestId }) => {
            const result = await client.execute<{ id: string }>(sql`
              update subscription_operation_requests
              set
                status = 'withdrawn',
                withdrawn_at = now(),
                updated_at = now()
              where id = ${operationRequestId}
                and tenant_id = ${input.tenantId}
                and status in ('pending', 'scheduled', 'processing')
              returning id
            `);

            return Boolean(result.rows[0]?.id);
          },
          writeAudit: (audit) =>
            writeAuditLog(
              {
                action: "subscription.operation_request.withdraw",
                details: audit,
                entityId: audit.subscriptionId,
                entityType: "subscription",
                mode: input.mode,
                outcome: "success",
                summary:
                  "Withdrew pending subscription operation request; no provider change occurred.",
              },
              client,
              { email: input.requestedByEmail, kind: "user" },
            ),
        }),
      ),
  });
}

async function transitionOperationRequest(input: {
  mode: "live" | "test";
  operationRequestId: string;
  requestedByEmail: string;
  targetStatus: "processing" | "scheduled";
  tenantId: string;
}) {
  return transitionSubscriptionOperationRequestWithDependencies(input, {
    runInTransaction: (callback) =>
      transaction(async (client) =>
        callback({
          lockOperationRequest: ({ mode, operationRequestId }) =>
            lockManagedOperationRequest(
              client,
              operationRequestId,
              mode,
              input.tenantId,
            ),
          updateStatus: async ({
            nextStatus,
            operationRequestId,
            previousStatus,
          }) => {
            const result = await client.execute<{ id: string }>(sql`
              update subscription_operation_requests
              set
                status = ${nextStatus},
                processing_at = case
                  when ${nextStatus} = 'processing'
                    then coalesce(processing_at, now())
                  else null
              end,
                updated_at = now()
              where id = ${operationRequestId}
                and tenant_id = ${input.tenantId}
                and status = ${previousStatus}
              returning id
            `);

            return Boolean(result.rows[0]?.id);
          },
          writeAudit: (audit) =>
            writeAuditLog(
              {
                action: "subscription.operation_request.transition",
                details: audit,
                entityId: audit.subscriptionId,
                entityType: "subscription",
                mode: input.mode,
                outcome: "success",
                summary:
                  "Changed pending subscription operation request status only; no provider change occurred.",
              },
              client,
              { email: input.requestedByEmail, kind: "user" },
            ),
        }),
      ),
  });
}

export async function recordCancellationRequestAction(formData: FormData) {
  const parsed = cancellationRequestSchema.safeParse(
    Object.fromEntries(formData.entries()),
  );

  if (!parsed.success) {
    redirectWithMessage("/customers", {
      error: "Cancellation request details are invalid.",
    });
  }

  const session = await requireViewerSession();
  const tenantSelection = await getCurrentTenantSelectionForViewer();
  const selectedMode = await getSelectedMollieMode();

  try {
    const result = await recordCancellationRequest({
      mode: selectedMode,
      operatorReason: parsed.data.operatorReason,
      paidPeriodEndDate: parsed.data.paidPeriodEndDate,
      requestedByEmail: session.user.email!,
      requestedEffectiveDate: parsed.data.requestedEffectiveDate,
      subscriptionId: parsed.data.subscriptionId,
      tenantId: tenantSelection.currentTenant.id,
    });

    if (result.status === "not_found") {
      redirectWithMessage("/customers", {
        error: "Subscription not found in the selected Mollie mode.",
      });
    }

    if (result.status === "denied") {
      redirectWithMessage(buildDrawerPath("customers", result.customerId), {
        error: "Cancellation request is not allowed for this subscription.",
      });
    }

    if (result.status === "duplicate") {
      redirectWithMessage(buildDrawerPath("customers", result.customerId), {
        notice: "Cancellation request was already recorded.",
      });
    }

    redirectWithMessage(buildDrawerPath("customers", result.customerId), {
      notice: "Cancellation request recorded for review. No provider change was made.",
    });
  } catch (error) {
    unstable_rethrow(error);
    redirectWithMessage("/customers", {
      error: "Cancellation request could not be recorded.",
    });
  }
}

export async function withdrawOperationRequestAction(formData: FormData) {
  const parsed = withdrawOperationRequestSchema.safeParse({
    operationRequestId: formData.get("operationRequestId"),
    returnTo: formData.get("returnTo") || undefined,
  });

  if (!parsed.success) {
    redirectWithMessage("/customers", {
      error: "Subscription request details are missing.",
    });
  }

  const session = await requireViewerSession();
  const tenantSelection = await getCurrentTenantSelectionForViewer();
  const selectedMode = await getSelectedMollieMode();

  try {
    const result = await withdrawOperationRequest({
      mode: selectedMode,
      operationRequestId: parsed.data.operationRequestId,
      requestedByEmail: session.user.email!,
      tenantId: tenantSelection.currentTenant.id,
    });

    if (result.status === "not_found") {
      redirectWithMessage(parsed.data.returnTo, {
        error: "Subscription request not found in the selected Mollie mode.",
      });
    }

    if (result.status === "not_withdrawable") {
      redirectWithMessage(parsed.data.returnTo, {
        notice: `Subscription request is already ${result.requestStatus}.`,
      });
    }

    revalidatePath("/customers");
    revalidatePath("/notifications");
    redirectWithMessage(parsed.data.returnTo, {
      notice: "Subscription request withdrawn. No provider change was made.",
    });
  } catch (error) {
    unstable_rethrow(error);
    redirectWithMessage(parsed.data.returnTo, {
      error: "Subscription request could not be withdrawn.",
    });
  }
}

function formatOperationRequestStatusLabel(status: "processing" | "scheduled") {
  return status === "processing" ? "processing" : "scheduled";
}

export async function transitionOperationRequestAction(formData: FormData) {
  const parsed = transitionOperationRequestSchema.safeParse({
    operationRequestId: formData.get("operationRequestId"),
    returnTo: formData.get("returnTo") || undefined,
    targetStatus: formData.get("targetStatus"),
  });

  if (!parsed.success) {
    redirectWithMessage("/customers", {
      error: "Subscription request transition details are missing.",
    });
  }

  const session = await requireViewerSession();
  const tenantSelection = await getCurrentTenantSelectionForViewer();
  const selectedMode = await getSelectedMollieMode();

  try {
    const result = await transitionOperationRequest({
      mode: selectedMode,
      operationRequestId: parsed.data.operationRequestId,
      requestedByEmail: session.user.email!,
      targetStatus: parsed.data.targetStatus,
      tenantId: tenantSelection.currentTenant.id,
    });

    if (result.status === "not_found") {
      redirectWithMessage(parsed.data.returnTo, {
        error: "Subscription request not found in the selected Mollie mode.",
      });
    }

    if (result.status === "not_transitionable") {
      redirectWithMessage(parsed.data.returnTo, {
        notice: `Subscription request is already ${result.requestStatus}.`,
      });
    }

    if (result.status === "transition_denied") {
      redirectWithMessage(parsed.data.returnTo, {
        error: `Subscription request cannot move from ${result.requestStatus} to ${result.targetStatus}.`,
      });
    }

    revalidatePath("/customers");
    revalidatePath("/notifications");
    redirectWithMessage(parsed.data.returnTo, {
      notice: `Subscription request marked ${formatOperationRequestStatusLabel(parsed.data.targetStatus)}. No provider change was made.`,
    });
  } catch (error) {
    unstable_rethrow(error);
    redirectWithMessage(parsed.data.returnTo, {
      error: "Subscription request status could not be updated.",
    });
  }
}

export async function syncSubscriptionAction(formData: FormData) {
  const parsed = manageSubscriptionSchema.safeParse({
    returnTo: formData.get("returnTo"),
    subscriptionId: formData.get("subscriptionId"),
  });

  if (!parsed.success) {
    redirectWithMessage("/customers", {
      error: "Subscription id is missing.",
    });
  }

  const session = await requireViewerSession();
  const tenantSelection = await getCurrentTenantSelectionForViewer();
  const selectedMode = await getSelectedMollieMode();
  const subscription = await getManagedSubscription(
    parsed.data.subscriptionId,
    tenantSelection.currentTenant.id,
  );

  if (!subscription || subscription.mode !== selectedMode) {
    redirectWithMessage("/customers", {
      error: "Subscription not found in the selected Mollie mode.",
    });
  }

  try {
    await syncSubscriptionByLocalId(subscription.id, {
      actor: {
        email: session.user.email ?? null,
        kind: "user",
      },
      strictMode: true,
      tenantId: tenantSelection.currentTenant.id,
    });

    revalidatePath("/customers");
    revalidatePath("/payments");
    revalidatePath("/notifications");
    redirectWithMessage(parsed.data.returnTo, {
      notice: "Subscription and payment history refreshed from Mollie.",
    });
  } catch (error) {
    unstable_rethrow(error);
    redirectWithMessage(parsed.data.returnTo, {
      error: serializeError(error),
    });
  }
}
