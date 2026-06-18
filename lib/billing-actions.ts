"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { z } from "zod";

import { writeAuditLog } from "@/lib/audit";
import {
  requireAdvancedOperationsSession,
  requireViewerSession,
} from "@/lib/auth/session";
import { getSelectedMollieMode } from "@/lib/dashboard-mode";
import {
  createDueFirstPaymentInvoicesBatch,
  queueRetryForFailedFirstPaymentInvoicesBatch,
} from "@/lib/eboekhouden/first-payment-invoices";
import { updateTenantBillingSettings } from "@/lib/billing-settings";
import {
  createDueRecurringInvoicesBatch,
  queueRetryForFailedRecurringInvoicesBatch,
} from "@/lib/eboekhouden/recurring-invoices";

const billingSettingsSchema = z.object({
  invoiceEmailDeliveryMode: z
    .enum(["app_smtp", "eboekhouden", "none"])
    .default("app_smtp"),
  invoiceTemplateId: z
    .union([z.string().trim().length(0), z.coerce.number().int().positive()])
    .transform((value) => (value === "" ? null : Number(value))),
  revenueLedgerId: z
    .union([z.string().trim().length(0), z.coerce.number().int().positive()])
    .transform((value) => (value === "" ? null : Number(value))),
  returnTo: z.string().trim().startsWith("/").default("/settings"),
});

const dueRecurringInvoicesSchema = z.object({
  returnTo: z.string().trim().startsWith("/").default("/settings"),
});

const failedRecurringRetrySchema = z.object({
  returnTo: z.string().trim().startsWith("/").default("/settings"),
  scheduleIds: z
    .string()
    .trim()
    .min(1, "At least one schedule ID is required.")
    .transform((value) =>
      value
        .split(/[\s,]+/)
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    ),
});

const failedFirstPaymentRetrySchema = z.object({
  paymentIds: z
    .string()
    .trim()
    .min(1, "At least one payment ID is required.")
    .transform((value) =>
      value
        .split(/[\s,]+/)
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    ),
  returnTo: z.string().trim().startsWith("/").default("/settings"),
});

function buildPath(pathname: string, params?: URLSearchParams) {
  const search = params?.toString();
  return search ? `${pathname}?${search}` : pathname;
}

function redirectWithMessage(
  pathname: string,
  options: { error?: string; notice?: string },
): never {
  const params = new URLSearchParams();

  if (options.notice) {
    params.set("notice", options.notice);
  }

  if (options.error) {
    params.set("error", options.error);
  }

  redirect(buildPath(pathname, params));
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return error.message.slice(0, 180);
  }

  return "Could not complete the billing action.";
}

export async function updateBillingSettingsAction(formData: FormData) {
  const parsed = billingSettingsSchema.safeParse({
    invoiceEmailDeliveryMode:
      formData.get("invoiceEmailDeliveryMode") || undefined,
    invoiceTemplateId: formData.get("invoiceTemplateId") ?? "",
    revenueLedgerId: formData.get("revenueLedgerId") ?? "",
    returnTo: formData.get("returnTo") || undefined,
  });

  if (!parsed.success) {
    redirectWithMessage("/settings", {
      error: "Billing settings input is invalid.",
    });
  }

  const session = await requireViewerSession();

  try {
    const settings = await updateTenantBillingSettings({
      invoiceEmailDeliveryMode: parsed.data.invoiceEmailDeliveryMode,
      invoiceTemplateId: parsed.data.invoiceTemplateId,
      revenueLedgerId: parsed.data.revenueLedgerId,
    });

    await writeAuditLog(
      {
        action: "tenant_billing_settings.update",
        details: {
          invoiceEmailDeliveryMode: settings?.invoiceEmailDeliveryMode ?? null,
          invoiceTemplateId: settings?.invoiceTemplateId ?? null,
          revenueLedgerId: settings?.revenueLedgerId ?? null,
          vatCode: settings?.vatCode ?? null,
        },
        entityId: "default",
        entityType: "tenant_billing_settings",
        outcome: "success",
        summary: "Updated tenant billing settings for recurring invoices.",
      },
      undefined,
      {
        email: session.user.email ?? null,
        kind: "user",
      },
    );

    revalidatePath("/settings");
    redirectWithMessage(parsed.data.returnTo, {
      notice: "Billing settings updated.",
    });
  } catch (error) {
    unstable_rethrow(error);
    redirectWithMessage(parsed.data.returnTo, {
      error: serializeError(error),
    });
  }
}

export async function createDueRecurringInvoicesAction(formData: FormData) {
  const parsed = dueRecurringInvoicesSchema.safeParse({
    returnTo: formData.get("returnTo") || undefined,
  });

  if (!parsed.success) {
    redirectWithMessage("/settings", {
      error: "Recurring invoice target is missing.",
    });
  }

  const session = await requireAdvancedOperationsSession();
  const selectedMode = await getSelectedMollieMode();

  try {
    const result = await createDueRecurringInvoicesBatch({
      actor: {
        email: session.user.email ?? null,
        kind: "user",
      },
      mode: selectedMode,
    });

    await writeAuditLog(
      {
        action: "recurring_invoice.batch_create",
        details: {
          actionableCount: result.actionableCount,
          createdCount: result.createdCount,
          failedCount: result.failedCount,
          remainingActionableCount: result.remainingActionableCount,
          skippedCount: result.skippedCount,
        },
        entityId: selectedMode,
        entityType: "recurring_billing_batch",
        mode: selectedMode,
        outcome: result.failedCount > 0 && result.createdCount === 0 ? "failure" : "success",
        summary: "Processed due recurring invoice creation for the selected Mollie mode.",
      },
      undefined,
      {
        email: session.user.email ?? null,
        kind: "user",
      },
    );

    revalidatePath("/");
    revalidatePath("/customers");
    revalidatePath("/notifications");
    revalidatePath("/settings");

    const message = [
      `Created ${result.createdCount} recurring invoice${result.createdCount === 1 ? "" : "s"}`,
      result.failedCount > 0
        ? `${result.failedCount} failed`
        : null,
      result.skippedCount > 0
        ? `${result.skippedCount} skipped`
        : null,
      result.remainingActionableCount > 0
        ? `${result.remainingActionableCount} more ready to run`
        : null,
    ]
      .filter((value): value is string => value !== null)
      .join(", ");

    if (result.failedCount > 0 && result.createdCount === 0) {
      redirectWithMessage(parsed.data.returnTo, {
        error: `${message}. Review notifications before retrying.`,
      });
    }

    redirectWithMessage(parsed.data.returnTo, {
      notice: `${message}.`,
    });
  } catch (error) {
    unstable_rethrow(error);
    redirectWithMessage(parsed.data.returnTo, {
      error: serializeError(error),
    });
  }
}

export async function createDueFirstPaymentInvoicesAction(formData: FormData) {
  const parsed = dueRecurringInvoicesSchema.safeParse({
    returnTo: formData.get("returnTo") || undefined,
  });

  if (!parsed.success) {
    redirectWithMessage("/settings", {
      error: "First-payment invoice target is missing.",
    });
  }

  const session = await requireAdvancedOperationsSession();
  const selectedMode = await getSelectedMollieMode();

  try {
    const result = await createDueFirstPaymentInvoicesBatch({
      actor: {
        email: session.user.email ?? null,
        kind: "user",
      },
      mode: selectedMode,
    });

    await writeAuditLog(
      {
        action: "first_payment_invoice.batch_create",
        details: {
          actionableCount: result.actionableCount,
          createdCount: result.createdCount,
          failedCount: result.failedCount,
          remainingActionableCount: result.remainingActionableCount,
          skippedCount: result.skippedCount,
        },
        entityId: selectedMode,
        entityType: "first_payment_invoice_batch",
        mode: selectedMode,
        outcome: result.failedCount > 0 && result.createdCount === 0 ? "failure" : "success",
        summary: "Processed first-payment invoice creation for the selected Mollie mode.",
      },
      undefined,
      {
        email: session.user.email ?? null,
        kind: "user",
      },
    );

    revalidatePath("/");
    revalidatePath("/customers");
    revalidatePath("/notifications");
    revalidatePath("/payments");
    revalidatePath("/settings");

    const message = [
      `Created ${result.createdCount} first-payment invoice${result.createdCount === 1 ? "" : "s"}`,
      result.failedCount > 0 ? `${result.failedCount} failed` : null,
      result.skippedCount > 0 ? `${result.skippedCount} skipped` : null,
      result.remainingActionableCount > 0
        ? `${result.remainingActionableCount} more ready to run`
        : null,
    ]
      .filter((value): value is string => value !== null)
      .join(", ");

    if (result.failedCount > 0 && result.createdCount === 0) {
      redirectWithMessage(parsed.data.returnTo, {
        error: `${message}. Review notifications before retrying.`,
      });
    }

    redirectWithMessage(parsed.data.returnTo, {
      notice: `${message}.`,
    });
  } catch (error) {
    unstable_rethrow(error);
    redirectWithMessage(parsed.data.returnTo, {
      error: serializeError(error),
    });
  }
}

export async function queueFailedRecurringInvoiceRetriesAction(formData: FormData) {
  const parsed = failedRecurringRetrySchema.safeParse({
    returnTo: formData.get("returnTo") || undefined,
    scheduleIds: formData.get("scheduleIds") || "",
  });

  if (!parsed.success) {
    redirectWithMessage("/settings", {
      error: "Retry input is invalid. Provide one or more failed schedule IDs.",
    });
  }

  const session = await requireAdvancedOperationsSession();
  const selectedMode = await getSelectedMollieMode();

  try {
    const result = await queueRetryForFailedRecurringInvoicesBatch({
      actor: {
        email: session.user.email ?? null,
        kind: "user",
      },
      mode: selectedMode,
      scheduleIds: parsed.data.scheduleIds,
    });

    await writeAuditLog(
      {
        action: "recurring_invoice.retry_queue_batch",
        details: {
          mode: selectedMode,
          queuedCount: result.queuedCount,
          requestedCount: parsed.data.scheduleIds.length,
          skippedCount: result.skippedCount,
        },
        entityId: selectedMode,
        entityType: "recurring_billing_retry_batch",
        mode: selectedMode,
        outcome: result.queuedCount > 0 ? "success" : "failure",
        summary: "Processed controlled retry queue request for failed recurring invoices.",
      },
      undefined,
      {
        email: session.user.email ?? null,
        kind: "user",
      },
    );

    revalidatePath("/settings");
    revalidatePath("/notifications");

    const message = [
      `Queued ${result.queuedCount} failed recurring invoice retr${result.queuedCount === 1 ? "y" : "ies"}`,
      result.skippedCount > 0 ? `${result.skippedCount} skipped (not safe or not found)` : null,
    ]
      .filter((value): value is string => value !== null)
      .join(", ");

    if (result.queuedCount === 0) {
      redirectWithMessage(parsed.data.returnTo, {
        error: `${message}.`,
      });
    }

    redirectWithMessage(parsed.data.returnTo, {
      notice: `${message}.`,
    });
  } catch (error) {
    unstable_rethrow(error);
    redirectWithMessage(parsed.data.returnTo, {
      error: serializeError(error),
    });
  }
}

export async function queueFailedFirstPaymentInvoiceRetriesAction(formData: FormData) {
  const parsed = failedFirstPaymentRetrySchema.safeParse({
    paymentIds: formData.get("paymentIds") || "",
    returnTo: formData.get("returnTo") || undefined,
  });

  if (!parsed.success) {
    redirectWithMessage("/settings", {
      error: "Retry input is invalid. Provide one or more failed payment IDs.",
    });
  }

  const session = await requireAdvancedOperationsSession();
  const selectedMode = await getSelectedMollieMode();

  try {
    const result = await queueRetryForFailedFirstPaymentInvoicesBatch({
      actor: {
        email: session.user.email ?? null,
        kind: "user",
      },
      mode: selectedMode,
      paymentIds: parsed.data.paymentIds,
    });

    await writeAuditLog(
      {
        action: "first_payment_invoice.retry_queue_batch",
        details: {
          mode: selectedMode,
          queuedCount: result.queuedCount,
          requestedCount: parsed.data.paymentIds.length,
          skippedCount: result.skippedCount,
        },
        entityId: selectedMode,
        entityType: "first_payment_invoice_retry_batch",
        mode: selectedMode,
        outcome: result.queuedCount > 0 ? "success" : "failure",
        summary:
          "Processed controlled retry queue request for failed first-payment invoices.",
      },
      undefined,
      {
        email: session.user.email ?? null,
        kind: "user",
      },
    );

    revalidatePath("/settings");
    revalidatePath("/notifications");

    const message = [
      `Queued ${result.queuedCount} failed first-payment invoice retr${result.queuedCount === 1 ? "y" : "ies"}`,
      result.skippedCount > 0 ? `${result.skippedCount} skipped (not safe or not found)` : null,
    ]
      .filter((value): value is string => value !== null)
      .join(", ");

    if (result.queuedCount === 0) {
      redirectWithMessage(parsed.data.returnTo, {
        error: `${message}.`,
      });
    }

    redirectWithMessage(parsed.data.returnTo, {
      notice: `${message}.`,
    });
  } catch (error) {
    unstable_rethrow(error);
    redirectWithMessage(parsed.data.returnTo, {
      error: serializeError(error),
    });
  }
}
