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
  retryUnsentFirstPaymentInvoiceEmailsBatch,
  retryUnsentRecurringInvoiceEmailsBatch,
} from "@/lib/invoice-delivery";

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

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const mode = parseMode(request);
  const limit = parseLimit(request);

  try {
    const [safeFailedRecurringRetryQueue, safeFailedFirstPaymentRetryQueue] =
      await Promise.all([
        queueRetryForSafeFailedRecurringInvoicesBatch({
          actor: { kind: "system" },
          limit,
          mode,
        }),
        queueRetryForSafeFailedFirstPaymentInvoicesBatch({
          actor: { kind: "system" },
          limit,
          mode,
        }),
      ]);
    const [failedRecurringRecoveryResult, failedFirstPaymentRecoveryResult] =
      await Promise.all([
        recoverFailedRecurringInvoicesBatch({
          actor: { kind: "system" },
          limit,
          mode,
        }),
        recoverFailedFirstPaymentInvoicesBatch({
          actor: { kind: "system" },
          limit,
          mode,
        }),
      ]);
    const [recurringCreateResult, firstPaymentCreateResult] = await Promise.all([
      createDueRecurringInvoicesBatch({
        actor: { kind: "system" },
        limit,
        mode,
      }),
      createDueFirstPaymentInvoicesBatch({
        actor: { kind: "system" },
        limit,
        mode,
      }),
    ]);
    const [recurringDeliveryRetry, firstPaymentDeliveryRetry] = await Promise.all([
      retryUnsentRecurringInvoiceEmailsBatch({
        actor: { kind: "system" },
        limit,
        mode,
      }),
      retryUnsentFirstPaymentInvoiceEmailsBatch({
        actor: { kind: "system" },
        limit,
        mode,
      }),
    ]);

    await writeAuditLog(
      {
        action: "recurring_invoice.cron_batch_create",
        details: {
          failedFirstPaymentRecoveryResult,
          failedRecurringRecoveryResult,
          firstPaymentCreateResult,
          safeFailedFirstPaymentRetryQueue,
          safeFailedRecurringRetryQueue,
          recurringCreateResult,
          firstPaymentDeliveryRetry,
          recurringDeliveryRetry,
        },
        entityId: mode,
        entityType: "recurring_billing_cron",
        mode,
        outcome:
          recurringCreateResult.failedCount > 0 &&
          recurringCreateResult.createdCount === 0 &&
          firstPaymentCreateResult.failedCount > 0 &&
          firstPaymentCreateResult.createdCount === 0
            ? "failure"
            : "success",
        summary:
          "Processed recurring + first-payment invoice recovery/create/delivery automation through protected cron route.",
      },
      undefined,
      { kind: "system" },
    );

    return Response.json({
      safeFailedFirstPaymentRetryQueue,
      safeFailedRecurringRetryQueue,
      firstPaymentDeliveryRetry,
      failedFirstPaymentRecoveryResult,
      failedRecurringRecoveryResult,
      mode,
      limit,
      recurringDeliveryRetry,
      recurringCreateResult,
      firstPaymentCreateResult,
      status: "ok",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cron failed";
    await writeAuditLog(
      {
        action: "recurring_invoice.cron_batch_create",
        details: { error: message },
        entityId: mode,
        entityType: "recurring_billing_cron",
        mode,
        outcome: "failure",
        summary: "Recurring invoice cron run failed.",
      },
      undefined,
      { kind: "system" },
    );

    return Response.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return POST(request);
}
