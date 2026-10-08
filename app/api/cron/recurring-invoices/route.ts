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
import { discoverRecurringPaymentsBatch } from "@/lib/reliability/recurring-payment-recovery";
import { collectCronIssues, type CronIssue } from "@/lib/reliability/cron-issue-summary";
import { notifyCronIssues } from "@/lib/reliability/cron-issue-notification";

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
  runId?: string;
  completedStages?: string[];
  failedStages?: string[];
  paymentDiscovery: Awaited<ReturnType<typeof discoverRecurringPaymentsBatch>>;
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

function emptyTenantCronResult(input: { tenantId: string; tenantName: string; tenantSlug: string; mode: MollieMode }): TenantCronResult {
  return {
    paymentDiscovery: { repairedCount: 0, failedCount: 0, totalChecked: 0, assignedWebhookCount: 0, resolvedWebhookCount: 0 },
    activationJobs: { activatedCount: 0, attemptedCount: 0, exhaustedCount: 0, retriedCount: 0 },
    activationNotifications: { attemptedCount: 0, failedCount: 0, sentCount: 0 },
    failedFirstPaymentRecoveryResult: {
      ambiguousCount: 0,
      recoveredCount: 0,
      scannedCount: 0,
      verificationFailedCount: 0,
    },
    failedRecurringRecoveryResult: {
      ambiguousCount: 0,
      recoveredCount: 0,
      scannedCount: 0,
      verificationFailedCount: 0,
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
    mode: input.mode,
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
      failedCount: 0,
      paymentsChecked: 0,
      repairedCount: 0,
      skippedCount: 0,
      subscriptionsChecked: 0,
      totalChecked: 0,
    },
    tenantId: input.tenantId,
    tenantName: input.tenantName,
    tenantSlug: input.tenantSlug,
    webhookRepairResult: {
      failedCount: 0,
      repairedCount: 0,
      skippedCount: 0,
      totalChecked: 0,
    },
  };
}

async function runTenantCronBatch(input: {
  limit: number;
  mode: MollieMode;
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  runId: string;
}) {
  const repairLimit = Math.min(input.limit, 5);
  const webhookRepairLimit = Math.min(repairLimit, 2);
  const staleRepairLimit = Math.max(1, repairLimit - webhookRepairLimit);
  const result = emptyTenantCronResult(input);
  result.runId = input.runId;
  result.completedStages = [];
  result.failedStages = [];

  // Keep completed results if a later stage aborts. Zero counters for stages not
  // listed in completedStages are placeholders, not proof that no work occurred.
  async function stage<K extends keyof TenantCronResult>(key: K, work: () => Promise<TenantCronResult[K]>) {
    try {
      result[key] = await work();
      result.completedStages!.push(key);
    } catch {
      result.failedStages!.push(key);
      throw new Error("Cron stage aborted");
    }
  }
  async function together(work: Promise<void>[]) {
    // A sibling can still complete billing after another rejects. Await both
    // before recording results or ending the serverless invocation.
    const settled = await Promise.allSettled(work);
    if (settled.some((entry) => entry.status === "rejected")) throw new Error("Cron stage aborted");
  }
  const context = { actor: { kind: "system" as const }, limit: input.limit, mode: input.mode, tenantId: input.tenantId };
  try {
    await stage("paymentDiscovery", () => discoverRecurringPaymentsBatch(context));
    await stage("webhookRepairResult", () => repairWebhookEventsBatch({ ...context, limit: webhookRepairLimit, tenantId: input.tenantId }));
    await stage("staleRepairResult", () => repairStaleRecordsBatch({ ...context, limit: staleRepairLimit, tenantId: input.tenantId }));
    await stage("activationJobs", () => processSubscriptionActivationJobsBatch(context));
    await together([
      stage("safeFailedRecurringRetryQueue", () => queueRetryForSafeFailedRecurringInvoicesBatch({ ...context, tenantId: input.tenantId })),
      stage("safeFailedFirstPaymentRetryQueue", () => queueRetryForSafeFailedFirstPaymentInvoicesBatch({ ...context, tenantId: input.tenantId })),
    ]);
    await together([
      stage("failedRecurringRecoveryResult", () => recoverFailedRecurringInvoicesBatch({ ...context, tenantId: input.tenantId })),
      stage("failedFirstPaymentRecoveryResult", () => recoverFailedFirstPaymentInvoicesBatch({ ...context, tenantId: input.tenantId })),
    ]);
    await together([
      stage("recurringCreateResult", () => createDueRecurringInvoicesBatch(context)),
      stage("firstPaymentCreateResult", () => createDueFirstPaymentInvoicesBatch(context)),
    ]);
    await together([
      stage("recurringDeliveryRetry", () => retryUnsentRecurringInvoiceEmailsBatch({ ...context, tenantId: input.tenantId })),
      stage("firstPaymentDeliveryRetry", () => retryUnsentFirstPaymentInvoiceEmailsBatch({ ...context, tenantId: input.tenantId })),
    ]);
    await stage("activationNotifications", () => deliverSubscriptionActivationNotificationsBatch(context));
  } catch {
    // Stop dependent phases. Completed sibling/earlier results remain available;
    // the failed stage may have side effects and must be inspected before retry.
  }
  try {
    await writeAuditLog({
      action: "recurring_invoice.cron_batch_create",
      details: result,
      entityId: input.tenantId,
      entityType: "tenant_recurring_billing_cron",
      mode: input.mode,
      outcome: collectCronIssues(result).length > 0 ? "failure" : "success",
      summary: result.failedStages.length ? "Cron stopped after a stage failed; inspect completed stages before retrying." : "Processed protected billing and recovery cron stages.",
    }, undefined, { kind: "system" });
  } catch {
    result.failedStages.push("cronAudit");
    console.error("Kify tenant cron audit failed.", { runId: input.runId, tenantId: input.tenantId, mode: input.mode });
  }
  return result;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const mode = parseMode(request);
  const limit = parseLimit(request);
  const tenantResults: TenantCronResult[] = [];
  const issues: CronIssue[] = [];
  const runId = crypto.randomUUID();

  try {
    const tenants = await listTenants();
    for (const tenant of tenants) {
      try {
        const result = await runTenantCronBatch({
          limit,
          mode,
          tenantId: tenant.id,
          tenantName: tenant.name,
          tenantSlug: tenant.slug,
          runId,
        });
        tenantResults.push(result);
        issues.push(...collectCronIssues(result));
      } catch (error) {
        issues.push({ tenantId: tenant.id, tenantName: tenant.name, stage: "Tenant cron aborted; review its audit history", count: 1 });
        const message = error instanceof Error ? error.message : "Cron failed";
        tenantResults.push(emptyTenantCronResult({ tenantId: tenant.id, tenantName: tenant.name, tenantSlug: tenant.slug, mode }));
        try { await writeAuditLog(
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
        ); } catch {
          console.error("Kify tenant cron failure audit unavailable.", { runId, tenantId: tenant.id, mode });
        }
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

    if (tenantResults.some((result) => result.paymentDiscovery.repairedCount > 0) || webhookRepaired || staleRepaired || createdInvoices || deliveredEmails) {
      try {
        revalidatePath("/");
        revalidatePath("/customers");
        revalidatePath("/notifications");
        revalidatePath("/payments");
        revalidatePath("/settings");
      } catch {
        issues.push({ tenantId: null, tenantName: "Kify", stage: "Billing finished but cache refresh failed; refresh the UI and inspect runtime logs", count: 1 });
      }
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
          verificationFailedCount:
            accumulator.failedFirstPaymentRecoveryResult.verificationFailedCount +
            result.failedFirstPaymentRecoveryResult.verificationFailedCount,
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
          verificationFailedCount:
            accumulator.failedRecurringRecoveryResult.verificationFailedCount +
            result.failedRecurringRecoveryResult.verificationFailedCount,
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
          failedCount:
            accumulator.staleRepairResult.failedCount +
            result.staleRepairResult.failedCount,
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
          failedCount:
            accumulator.webhookRepairResult.failedCount +
            result.webhookRepairResult.failedCount,
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
          verificationFailedCount: 0,
        },
        failedRecurringRecoveryResult: {
          ambiguousCount: 0,
          recoveredCount: 0,
          scannedCount: 0,
          verificationFailedCount: 0,
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
          failedCount: 0,
          paymentsChecked: 0,
          repairedCount: 0,
          skippedCount: 0,
          subscriptionsChecked: 0,
          totalChecked: 0,
        },
        webhookRepairResult: {
          failedCount: 0,
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
      runId,
      issues,
      status: issues.length === 0 ? "ok" : "partial",
      tenantResults,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    issues.push({ tenantId: null, tenantName: "Kify", stage: "Cron could not finish; review runtime logs", count: 1 });
    const message = error instanceof Error ? error.message : "Cron failed";
    return Response.json({ error: message }, { status: 500 });
  } finally {
    // Await one consolidated notification before the serverless invocation ends.
    // The notifier contains its failures so SMTP cannot trigger billing replay.
    try {
      await notifyCronIssues({ issues, mode, runId });
    } catch {
      console.error("Kify cron issue notification failed.", { runId, mode });
    }
  }
}

export async function GET(request: Request) {
  return POST(request);
}
