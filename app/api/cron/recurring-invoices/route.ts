import { revalidatePath } from "next/cache";

import { writeAuditLog } from "@/lib/audit";
import {
  createDueFirstPaymentInvoicesBatch,
  queueRetryForSafeFailedFirstPaymentInvoicesBatch,
  recoverFailedFirstPaymentInvoicesBatch,
} from "@/lib/eboekhouden/first-payment-invoices";
import {
  createDueRecurringInvoicesBatch,
  queueRetryForSafeFailedRecurringInvoicesBatch,
  recoverFailedRecurringInvoicesBatch,
} from "@/lib/eboekhouden/recurring-invoices";
import { getAcceptedCronSecrets, isBearerAuthorized } from "@/lib/cron-auth";
import { env, type MollieMode } from "@/lib/env";
import {
  processSubscriptionActivationJobsBatch,
} from "@/lib/onboarding/subscription-activation-jobs";
import {
  deliverSubscriptionActivationNotificationsBatch,
} from "@/lib/onboarding/subscription-activation-notifications";
import {
  retryUnsentFirstPaymentInvoiceEmailsBatch,
  retryUnsentRecurringInvoiceEmailsBatch,
} from "@/lib/invoice-delivery";
import {
  repairStaleRecordsBatch,
  repairWebhookEventsBatch,
} from "@/lib/reliability/repair";
import { listTenants } from "@/lib/tenants";

function isAuthorized(request: Request) {
  const secrets = getAcceptedCronSecrets({
    cronSecret: process.env.CRON_SECRET,
    invoiceCronSharedSecret: env.INVOICE_CRON_SHARED_SECRET,
  });
  if (secrets.length === 0) {
    return false;
  }

  return isBearerAuthorized(request.headers.get("authorization"), secrets);
}

function parseMode(request: Request): MollieMode {
  const mode = new URL(request.url).searchParams.get("mode");
  if (mode === "live" || mode === "test") {
    return mode;
  }

  return env.MOLLIE_DEFAULT_MODE;
}

function parseLimit(request: Request) {
  const value = Number(new URL(request.url).searchParams.get("limit") ?? "25");
  if (!Number.isFinite(value)) {
    return 25;
  }

  return Math.min(Math.max(Math.trunc(value), 1), 200);
}

type TenantCronResult = {
  activationJobs: Awaited<ReturnType<typeof processSubscriptionActivationJobsBatch>>;
  activationNotifications: Awaited<ReturnType<typeof deliverSubscriptionActivationNotificationsBatch>>;
  failedFirstPaymentRecoveryResult: Awaited<
    ReturnType<typeof recoverFailedFirstPaymentInvoicesBatch>
  >;
  failedRecurringRecoveryResult: Awaited<
    ReturnType<typeof recoverFailedRecurringInvoicesBatch>
  >;
  firstPaymentCreateResult: Awaited<
    ReturnType<typeof createDueFirstPaymentInvoicesBatch>
  >;
  firstPaymentDeliveryRetry: Awaited<
    ReturnType<typeof retryUnsentFirstPaymentInvoiceEmailsBatch>
  >;
  mode: MollieMode;
  recurringCreateResult: Awaited<
    ReturnType<typeof createDueRecurringInvoicesBatch>
  >;
  recurringDeliveryRetry: Awaited<
    ReturnType<typeof retryUnsentRecurringInvoiceEmailsBatch>
  >;
  safeFailedFirstPaymentRetryQueue: Awaited<
    ReturnType<typeof queueRetryForSafeFailedFirstPaymentInvoicesBatch>
  >;
  safeFailedRecurringRetryQueue: Awaited<
    ReturnType<typeof queueRetryForSafeFailedRecurringInvoicesBatch>
  >;
  staleRepairResult: Awaited<ReturnType<typeof repairStaleRecordsBatch>>;
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  webhookRepairResult: Awaited<ReturnType<typeof repairWebhookEventsBatch>>;
};

async function runTenantCronBatch(input: {
  limit: number;
  mode: MollieMode;
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
}) {
  const repairLimit = Math.min(input.limit, 5);
  const webhookRepairLimit = Math.min(repairLimit, 2);
  const staleRepairLimit = Math.max(1, repairLimit - webhookRepairLimit);

  const webhookRepairResult = await repairWebhookEventsBatch({
    actor: { kind: "system" },
    limit: webhookRepairLimit,
    mode: input.mode,
    tenantId: input.tenantId,
  });
  const staleRepairResult = await repairStaleRecordsBatch({
    actor: { kind: "system" },
    limit: staleRepairLimit,
    mode: input.mode,
    tenantId: input.tenantId,
  });
  const activationJobs = await processSubscriptionActivationJobsBatch({
    limit: input.limit,
    mode: input.mode,
    tenantId: input.tenantId,
  });
  const [safeFailedRecurringRetryQueue, safeFailedFirstPaymentRetryQueue] =
    await Promise.all([
      queueRetryForSafeFailedRecurringInvoicesBatch({
        actor: { kind: "system" },
        limit: input.limit,
        mode: input.mode,
        tenantId: input.tenantId,
      }),
      queueRetryForSafeFailedFirstPaymentInvoicesBatch({
        actor: { kind: "system" },
        limit: input.limit,
        mode: input.mode,
        tenantId: input.tenantId,
      }),
    ]);
  const [failedRecurringRecoveryResult, failedFirstPaymentRecoveryResult] =
    await Promise.all([
      recoverFailedRecurringInvoicesBatch({
        actor: { kind: "system" },
        limit: input.limit,
        mode: input.mode,
        tenantId: input.tenantId,
      }),
      recoverFailedFirstPaymentInvoicesBatch({
        actor: { kind: "system" },
        limit: input.limit,
        mode: input.mode,
        tenantId: input.tenantId,
      }),
    ]);
  const [recurringCreateResult, firstPaymentCreateResult] = await Promise.all([
    createDueRecurringInvoicesBatch({
      actor: { kind: "system" },
      limit: input.limit,
      mode: input.mode,
      tenantId: input.tenantId,
    }),
    createDueFirstPaymentInvoicesBatch({
      actor: { kind: "system" },
      limit: input.limit,
      mode: input.mode,
      tenantId: input.tenantId,
    }),
  ]);
  const [recurringDeliveryRetry, firstPaymentDeliveryRetry] = await Promise.all([
    retryUnsentRecurringInvoiceEmailsBatch({
      actor: { kind: "system" },
      limit: input.limit,
      mode: input.mode,
      tenantId: input.tenantId,
    }),
    retryUnsentFirstPaymentInvoiceEmailsBatch({
      actor: { kind: "system" },
      limit: input.limit,
      mode: input.mode,
      tenantId: input.tenantId,
    }),
  ]);
  const activationNotifications = await deliverSubscriptionActivationNotificationsBatch({
    limit: input.limit,
    mode: input.mode,
    tenantId: input.tenantId,
  });

  const result = {
    activationJobs,
    activationNotifications,
    failedFirstPaymentRecoveryResult,
    failedRecurringRecoveryResult,
    firstPaymentCreateResult,
    firstPaymentDeliveryRetry,
    mode: input.mode,
    recurringCreateResult,
    recurringDeliveryRetry,
    safeFailedFirstPaymentRetryQueue,
    safeFailedRecurringRetryQueue,
    staleRepairResult,
    tenantId: input.tenantId,
    tenantName: input.tenantName,
    tenantSlug: input.tenantSlug,
    webhookRepairResult,
  };

  await writeAuditLog(
    {
      action: "recurring_invoice.cron_batch_create",
      details: result,
      entityId: input.tenantId,
      entityType: "tenant_recurring_billing_cron",
      mode: input.mode,
      outcome:
        recurringCreateResult.failedCount > 0 &&
        recurringCreateResult.createdCount === 0 &&
        firstPaymentCreateResult.failedCount > 0 &&
        firstPaymentCreateResult.createdCount === 0
          ? "failure"
          : "success",
      summary:
        "Processed subscription activation recovery, activation notifications, invoice automation, webhook repair, and stale repair through protected cron route.",
    },
    undefined,
    { kind: "system" },
  );

  return result;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const mode = parseMode(request);
  const limit = parseLimit(request);
  const tenants = await listTenants();
  const tenantResults: TenantCronResult[] = [];
  let hadAnySuccess = false;

  try {
    for (const tenant of tenants) {
      try {
        const result = await runTenantCronBatch({
          limit,
          mode,
          tenantId: tenant.id,
          tenantName: tenant.name,
          tenantSlug: tenant.slug,
        });
        tenantResults.push(result);
        hadAnySuccess = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Cron failed";
        tenantResults.push({
          activationJobs: { activatedCount: 0, attemptedCount: 0, exhaustedCount: 0, retriedCount: 0 },
          activationNotifications: { attemptedCount: 0, failedCount: 0, sentCount: 0 },
          failedFirstPaymentRecoveryResult: {
            ambiguousCount: 0,
            recoveredCount: 0,
            scannedCount: 0,
          },
          failedRecurringRecoveryResult: {
            ambiguousCount: 0,
            recoveredCount: 0,
            scannedCount: 0,
          },
          firstPaymentCreateResult: {
            actionableCount: 0,
            createdCount: 0,
            failedCount: 0,
            remainingActionableCount: 0,
            skippedCount: 0,
          },
          firstPaymentDeliveryRetry: {
            attemptedCount: 0,
            failedCount: 0,
            sentCount: 0,
            skippedCount: 0,
          },
          mode,
          recurringCreateResult: {
            actionableCount: 0,
            createdCount: 0,
            failedCount: 0,
            remainingActionableCount: 0,
            skippedCount: 0,
          },
          recurringDeliveryRetry: {
            attemptedCount: 0,
            failedCount: 0,
            sentCount: 0,
            skippedCount: 0,
          },
          safeFailedFirstPaymentRetryQueue: {
            queuedCount: 0,
            skippedCount: 0,
          },
          safeFailedRecurringRetryQueue: {
            queuedCount: 0,
            skippedCount: 0,
          },
          staleRepairResult: {
            customersChecked: 0,
            paymentsChecked: 0,
            repairedCount: 0,
            skippedCount: 0,
            subscriptionsChecked: 0,
            totalChecked: 0,
          },
          tenantId: tenant.id,
          tenantName: tenant.name,
          tenantSlug: tenant.slug,
          webhookRepairResult: {
            repairedCount: 0,
            skippedCount: 0,
            totalChecked: 0,
          },
        });
        await writeAuditLog(
          {
            action: "recurring_invoice.cron_batch_create",
            details: {
              error: message,
              tenantId: tenant.id,
              tenantName: tenant.name,
              tenantSlug: tenant.slug,
            },
            entityId: tenant.id,
            entityType: "tenant_recurring_billing_cron",
            mode,
            outcome: "failure",
            summary: "Recurring invoice cron run failed.",
          },
          undefined,
          { kind: "system" },
        );
      }
    }

    const webhookRepaired = tenantResults.some(
      (result) => result.webhookRepairResult.repairedCount > 0,
    );
    const staleRepaired = tenantResults.some(
      (result) => result.staleRepairResult.repairedCount > 0,
    );
    const createdInvoices = tenantResults.some(
      (result) =>
        result.recurringCreateResult.createdCount > 0 ||
        result.firstPaymentCreateResult.createdCount > 0,
    );
    const deliveredEmails = tenantResults.some(
      (result) =>
        result.recurringDeliveryRetry.sentCount > 0 ||
        result.firstPaymentDeliveryRetry.sentCount > 0 ||
        result.activationNotifications.sentCount > 0,
    );

    if (webhookRepaired || staleRepaired || createdInvoices || deliveredEmails) {
      revalidatePath("/");
      revalidatePath("/customers");
      revalidatePath("/notifications");
      revalidatePath("/payments");
      revalidatePath("/settings");
    }

    const aggregate = tenantResults.reduce(
      (accumulator, result) => ({
        failedFirstPaymentRecoveryResult: {
          ambiguousCount:
            accumulator.failedFirstPaymentRecoveryResult.ambiguousCount +
            result.failedFirstPaymentRecoveryResult.ambiguousCount,
          recoveredCount:
            accumulator.failedFirstPaymentRecoveryResult.recoveredCount +
            result.failedFirstPaymentRecoveryResult.recoveredCount,
          scannedCount:
            accumulator.failedFirstPaymentRecoveryResult.scannedCount +
            result.failedFirstPaymentRecoveryResult.scannedCount,
        },
        failedRecurringRecoveryResult: {
          ambiguousCount:
            accumulator.failedRecurringRecoveryResult.ambiguousCount +
            result.failedRecurringRecoveryResult.ambiguousCount,
          recoveredCount:
            accumulator.failedRecurringRecoveryResult.recoveredCount +
            result.failedRecurringRecoveryResult.recoveredCount,
          scannedCount:
            accumulator.failedRecurringRecoveryResult.scannedCount +
            result.failedRecurringRecoveryResult.scannedCount,
        },
        firstPaymentCreateResult: {
          actionableCount:
            accumulator.firstPaymentCreateResult.actionableCount +
            result.firstPaymentCreateResult.actionableCount,
          createdCount:
            accumulator.firstPaymentCreateResult.createdCount +
            result.firstPaymentCreateResult.createdCount,
          failedCount:
            accumulator.firstPaymentCreateResult.failedCount +
            result.firstPaymentCreateResult.failedCount,
          remainingActionableCount:
            accumulator.firstPaymentCreateResult.remainingActionableCount +
            result.firstPaymentCreateResult.remainingActionableCount,
          skippedCount:
            accumulator.firstPaymentCreateResult.skippedCount +
            result.firstPaymentCreateResult.skippedCount,
        },
        firstPaymentDeliveryRetry: {
          attemptedCount:
            accumulator.firstPaymentDeliveryRetry.attemptedCount +
            result.firstPaymentDeliveryRetry.attemptedCount,
          failedCount:
            accumulator.firstPaymentDeliveryRetry.failedCount +
            result.firstPaymentDeliveryRetry.failedCount,
          sentCount:
            accumulator.firstPaymentDeliveryRetry.sentCount +
            result.firstPaymentDeliveryRetry.sentCount,
          skippedCount:
            accumulator.firstPaymentDeliveryRetry.skippedCount +
            result.firstPaymentDeliveryRetry.skippedCount,
        },
        recurringCreateResult: {
          actionableCount:
            accumulator.recurringCreateResult.actionableCount +
            result.recurringCreateResult.actionableCount,
          createdCount:
            accumulator.recurringCreateResult.createdCount +
            result.recurringCreateResult.createdCount,
          failedCount:
            accumulator.recurringCreateResult.failedCount +
            result.recurringCreateResult.failedCount,
          remainingActionableCount:
            accumulator.recurringCreateResult.remainingActionableCount +
            result.recurringCreateResult.remainingActionableCount,
          skippedCount:
            accumulator.recurringCreateResult.skippedCount +
            result.recurringCreateResult.skippedCount,
        },
        recurringDeliveryRetry: {
          attemptedCount:
            accumulator.recurringDeliveryRetry.attemptedCount +
            result.recurringDeliveryRetry.attemptedCount,
          failedCount:
            accumulator.recurringDeliveryRetry.failedCount +
            result.recurringDeliveryRetry.failedCount,
          sentCount:
            accumulator.recurringDeliveryRetry.sentCount +
            result.recurringDeliveryRetry.sentCount,
          skippedCount:
            accumulator.recurringDeliveryRetry.skippedCount +
            result.recurringDeliveryRetry.skippedCount,
        },
        safeFailedFirstPaymentRetryQueue: {
          queuedCount:
            accumulator.safeFailedFirstPaymentRetryQueue.queuedCount +
            result.safeFailedFirstPaymentRetryQueue.queuedCount,
          skippedCount:
            accumulator.safeFailedFirstPaymentRetryQueue.skippedCount +
            result.safeFailedFirstPaymentRetryQueue.skippedCount,
        },
        safeFailedRecurringRetryQueue: {
          queuedCount:
            accumulator.safeFailedRecurringRetryQueue.queuedCount +
            result.safeFailedRecurringRetryQueue.queuedCount,
          skippedCount:
            accumulator.safeFailedRecurringRetryQueue.skippedCount +
            result.safeFailedRecurringRetryQueue.skippedCount,
        },
        staleRepairResult: {
          customersChecked:
            accumulator.staleRepairResult.customersChecked +
            result.staleRepairResult.customersChecked,
          paymentsChecked:
            accumulator.staleRepairResult.paymentsChecked +
            result.staleRepairResult.paymentsChecked,
          repairedCount:
            accumulator.staleRepairResult.repairedCount +
            result.staleRepairResult.repairedCount,
          skippedCount:
            accumulator.staleRepairResult.skippedCount +
            result.staleRepairResult.skippedCount,
          subscriptionsChecked:
            accumulator.staleRepairResult.subscriptionsChecked +
            result.staleRepairResult.subscriptionsChecked,
          totalChecked:
            accumulator.staleRepairResult.totalChecked +
            result.staleRepairResult.totalChecked,
        },
        webhookRepairResult: {
          repairedCount:
            accumulator.webhookRepairResult.repairedCount +
            result.webhookRepairResult.repairedCount,
          skippedCount:
            accumulator.webhookRepairResult.skippedCount +
            result.webhookRepairResult.skippedCount,
          totalChecked:
            accumulator.webhookRepairResult.totalChecked +
            result.webhookRepairResult.totalChecked,
        },
      }),
      {
        failedFirstPaymentRecoveryResult: {
          ambiguousCount: 0,
          recoveredCount: 0,
          scannedCount: 0,
        },
        failedRecurringRecoveryResult: {
          ambiguousCount: 0,
          recoveredCount: 0,
          scannedCount: 0,
        },
        firstPaymentCreateResult: {
          actionableCount: 0,
          createdCount: 0,
          failedCount: 0,
          remainingActionableCount: 0,
          skippedCount: 0,
        },
        firstPaymentDeliveryRetry: {
          attemptedCount: 0,
          failedCount: 0,
          sentCount: 0,
          skippedCount: 0,
        },
        recurringCreateResult: {
          actionableCount: 0,
          createdCount: 0,
          failedCount: 0,
          remainingActionableCount: 0,
          skippedCount: 0,
        },
        recurringDeliveryRetry: {
          attemptedCount: 0,
          failedCount: 0,
          sentCount: 0,
          skippedCount: 0,
        },
        safeFailedFirstPaymentRetryQueue: {
          queuedCount: 0,
          skippedCount: 0,
        },
        safeFailedRecurringRetryQueue: {
          queuedCount: 0,
          skippedCount: 0,
        },
        staleRepairResult: {
          customersChecked: 0,
          paymentsChecked: 0,
          repairedCount: 0,
          skippedCount: 0,
          subscriptionsChecked: 0,
          totalChecked: 0,
        },
        webhookRepairResult: {
          repairedCount: 0,
          skippedCount: 0,
          totalChecked: 0,
        },
      },
    );

    return Response.json({
      aggregate,
      limit,
      mode,
      status: hadAnySuccess ? "ok" : "partial",
      tenantResults,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cron failed";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return POST(request);
}
