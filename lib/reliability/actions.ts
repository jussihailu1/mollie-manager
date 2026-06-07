"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { sql } from "drizzle-orm";
import { z } from "zod";

import { writeAuditLog } from "@/lib/audit";
import { requireViewerSession } from "@/lib/auth/session";
import { getSelectedMollieMode } from "@/lib/dashboard-mode";
import { getDb, transaction } from "@/lib/db";
import { env } from "@/lib/env";
import { notificationsAreConfigured } from "@/lib/notifications/email";
import { deliverAlertEmail } from "@/lib/reliability/alerts";
import { serializeReconciliationSummary } from "@/lib/reliability/reconciliation-summary";
import {
  reconcileOperationalData,
  type ReconciliationMode,
  syncPaymentByMollieId,
  syncPaymentLinkByMollieId,
  syncSubscriptionByMollieId,
} from "@/lib/reliability/sync";

const redirectSchema = z.object({
  returnTo: z.string().trim().startsWith("/").default("/notifications"),
});

const replayWebhookSchema = redirectSchema.extend({
  webhookEventId: z.string().uuid(),
});

const reconciliationSchema = redirectSchema.extend({
  reconciliationMode: z.enum(["full", "sync_only"]).default("sync_only"),
});

const updateAlertStatusSchema = redirectSchema.extend({
  alertId: z.string().uuid(),
  status: z.enum(["open", "acknowledged", "resolved"]),
});

type StoredWebhookEvent = {
  id: string;
  mode: "live" | "test";
  processingStatus: "failed" | "ignored" | "pending" | "processed";
  resourceId: string | null;
  resourceType: string | null;
};

function buildPath(pathname: string, params?: URLSearchParams) {
  const search = params?.toString();
  return search ? `${pathname}?${search}` : pathname;
}

function redirectWithMessage(
  pathname: string,
  options: {
    error?: string;
    notice?: string;
    reconciliationSummary?: string;
  },
): never {
  const params = new URLSearchParams();

  if (options.notice) {
    params.set("notice", options.notice);
  }

  if (options.error) {
    params.set("error", options.error);
  }

  if (options.reconciliationSummary) {
    params.set("reconciliationSummary", options.reconciliationSummary);
  }

  redirect(buildPath(pathname, params));
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return error.message.slice(0, 180);
  }

  return "Something went wrong while processing the reliability task.";
}

const alertModeExpression = sql<"live" | "test" | null>`
  coalesce(
    p.mode,
    s.mode,
    c.mode,
    case
      when a.payload ->> 'mode' in ('test', 'live')
        then (a.payload ->> 'mode')::mollie_mode
      else null
    end
  )
`;

async function processStoredWebhookResource(
  resourceId: string,
  mode: "live" | "test",
) {
  if (resourceId.startsWith("tr_")) {
    return syncPaymentByMollieId(resourceId, {
      actor: {
        kind: "system",
      },
      preferredMode: mode,
      strictMode: true,
    });
  }

  if (resourceId.startsWith("sub_")) {
    return syncSubscriptionByMollieId(resourceId, {
      actor: {
        kind: "system",
      },
      preferredMode: mode,
      strictMode: true,
    });
  }

  if (resourceId.startsWith("pl_")) {
    return syncPaymentLinkByMollieId(resourceId, {
      actor: {
        kind: "system",
      },
      preferredMode: mode,
      strictMode: true,
    });
  }

  throw new Error("Unsupported webhook resource id.");
}

async function updateAlertStatus(
  alertId: string,
  status: "open" | "acknowledged" | "resolved",
  mode: "live" | "test",
) {
  await getDb().execute(sql`
      update alerts
      set
        status = ${status},
        acknowledged_at = case
          when ${status} in ('acknowledged', 'resolved')
            then coalesce(acknowledged_at, now())
          else null
        end,
        resolved_at = case
          when ${status} = 'resolved'
            then coalesce(resolved_at, now())
          else null
        end,
        updated_at = now()
      where id = ${alertId}
        and id in (
          select a.id
          from alerts a
          left join payments p on p.id = a.payment_id
          left join subscriptions s on s.id = a.subscription_id
          left join customers c on c.id = coalesce(a.customer_id, p.customer_id, s.customer_id)
          where ${alertModeExpression} = ${mode}
        )
    `);
}

export async function runReconciliationAction(formData: FormData) {
  const parsed = reconciliationSchema.safeParse({
    reconciliationMode: formData.get("reconciliationMode") || undefined,
    returnTo: formData.get("returnTo"),
  });

  if (!parsed.success) {
    redirectWithMessage("/notifications", {
      error: "Reconciliation target is missing.",
    });
  }

  const session = await requireViewerSession();
  const selectedMode = await getSelectedMollieMode();

  try {
    const result = await reconcileOperationalData({
      actor: {
        email: session.user.email ?? null,
        kind: "user",
      },
      mode: selectedMode,
      reconciliationMode: parsed.data.reconciliationMode,
    });

    const reconciliationLabel = formatReconciliationMode(parsed.data.reconciliationMode);

    revalidatePath("/");
    revalidatePath("/notifications");
    revalidatePath("/payments");
    revalidatePath("/customers");
    revalidatePath("/settings");
    redirectWithMessage(parsed.data.returnTo, {
      notice: `${reconciliationLabel} reconciliation complete. Checked ${result.subscriptionsChecked} subscriptions, ${result.paymentLinksChecked} payment links, and ${result.firstPaymentsChecked} first payments. Review the invoice delta summary below.`,
      reconciliationSummary: serializeReconciliationSummary(result),
    });
  } catch (error) {
    unstable_rethrow(error);
    redirectWithMessage(parsed.data.returnTo, {
      error: serializeError(error),
    });
  }
}

function formatReconciliationMode(mode: ReconciliationMode) {
  return mode === "sync_only" ? "Sync-only" : "Full";
}

export async function replayWebhookEventAction(formData: FormData) {
  const parsed = replayWebhookSchema.safeParse({
    returnTo: formData.get("returnTo"),
    webhookEventId: formData.get("webhookEventId"),
  });

  if (!parsed.success) {
    redirectWithMessage("/notifications", {
      error: "Webhook event id is missing.",
    });
  }

  const session = await requireViewerSession();
  const selectedMode = await getSelectedMollieMode();

  const result = await getDb().execute<StoredWebhookEvent>(sql`
      select
        id,
        mode,
        processing_status as "processingStatus",
        resource_id as "resourceId",
        resource_type as "resourceType"
      from webhook_events
      where id = ${parsed.data.webhookEventId}
        and mode = ${selectedMode}
      limit 1
    `);
  const event = result.rows[0];

  if (!event?.resourceId || event.processingStatus !== "failed") {
    redirectWithMessage(parsed.data.returnTo, {
      error: "Only failed webhook events in the current mode can be replayed.",
    });
  }

  try {
    await processStoredWebhookResource(event.resourceId, event.mode);

    await getDb().execute(sql`
        update webhook_events
        set
          processing_status = 'processed',
          error_message = null,
          retry_count = retry_count + 1,
          last_attempt_at = now(),
          processed_at = now()
        where id = ${event.id}
      `);

    await writeAuditLog(
      {
        action: "webhook.event.replay",
        details: {
          mode: event.mode,
          resourceId: event.resourceId,
          resourceType: event.resourceType,
          webhookEventId: event.id,
        },
        entityId: event.id,
        entityType: "webhook_event",
        mode: event.mode,
        outcome: "success",
        summary: "Replayed a failed stored Mollie webhook event.",
      },
      undefined,
      {
        email: session.user.email ?? null,
        kind: "user",
      },
    );

    revalidatePath("/notifications");
    revalidatePath("/payments");
    revalidatePath("/customers");
    revalidatePath("/settings");
    redirectWithMessage(parsed.data.returnTo, {
      notice: "Webhook event replayed successfully.",
    });
  } catch (error) {
    unstable_rethrow(error);
    await getDb().execute(sql`
        update webhook_events
        set
          processing_status = 'failed',
          error_message = ${serializeError(error)},
          retry_count = retry_count + 1,
          last_attempt_at = now()
        where id = ${event.id}
      `);

    await writeAuditLog(
      {
        action: "webhook.event.replay",
        details: {
          error: serializeError(error),
          mode: event.mode,
          resourceId: event.resourceId,
          resourceType: event.resourceType,
          webhookEventId: event.id,
        },
        entityId: event.id,
        entityType: "webhook_event",
        mode: event.mode,
        outcome: "failure",
        summary: "Failed to replay a stored Mollie webhook event.",
      },
      undefined,
      {
        email: session.user.email ?? null,
        kind: "user",
      },
    );

    redirectWithMessage(parsed.data.returnTo, {
      error: serializeError(error),
    });
  }
}

export async function sendTestAlertAction(formData: FormData) {
  const parsed = redirectSchema.safeParse({
    returnTo: formData.get("returnTo"),
  });

  if (!parsed.success) {
    redirectWithMessage("/notifications", {
      error: "Notification target is missing.",
    });
  }

  const session = await requireViewerSession();
  const selectedMode = await getSelectedMollieMode();

  if (!notificationsAreConfigured()) {
    redirectWithMessage(parsed.data.returnTo, {
      error:
        "SMTP is not fully configured yet. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM, and ALERT_EMAIL_TO first.",
    });
  }

  const requestedAt = new Date().toISOString();
  const alertId = crypto.randomUUID();
  const title = `Manual test alert - ${requestedAt}`;
  const message = [
    "This is a manual test alert from Mollie Manager.",
    "",
    `Triggered at: ${requestedAt}`,
    `Requested by: ${session.user.email ?? "Unknown operator"}`,
    `App environment: ${env.APP_ENV}`,
    `Selected Mollie mode: ${selectedMode}`,
  ].join("\n");

  await transaction(async (client) => {
    await client.execute(sql`
        insert into alerts (
          id,
          severity,
          title,
          message,
          payload
        ) values (
          ${alertId},
          'info',
          ${title},
          ${message},
          ${JSON.stringify({
          kind: "manual_test",
          mode: selectedMode,
          requestedAt,
          requestedBy: session.user.email ?? null,
        })}::jsonb
        )
      `);
  });

  const delivery = await deliverAlertEmail({
    alertId,
    message,
    title,
  });
  const delivered = delivery.delivered;

  await writeAuditLog(
    {
      action: "alert.test.send",
      details: {
        delivered,
        error: delivery.error,
        mode: selectedMode,
        requestedAt,
      },
      entityId: alertId,
      entityType: "alert",
      mode: selectedMode,
      outcome: delivered ? "success" : "failure",
      summary: delivered
        ? "Sent a manual SMTP test alert."
        : "Created a manual test alert, but SMTP delivery failed.",
    },
    undefined,
    {
      email: session.user.email ?? null,
      kind: "user",
    },
  );

  revalidatePath("/notifications");

  if (!delivered) {
    redirectWithMessage(parsed.data.returnTo, {
      error: delivery.error
        ? `The test alert was stored locally, but SMTP delivery failed: ${delivery.error}`
        : "The test alert was stored locally, but the email could not be delivered. Review the SMTP settings and try again.",
    });
  }

  redirectWithMessage(parsed.data.returnTo, {
    notice: "Test alert sent. Check your inbox and the notifications page.",
  });
}

export async function setAlertStatusAction(formData: FormData) {
  const parsed = updateAlertStatusSchema.safeParse({
    alertId: formData.get("alertId"),
    returnTo: formData.get("returnTo") || undefined,
    status: formData.get("status"),
  });

  if (!parsed.success) {
    redirectWithMessage("/notifications", {
      error: "Alert update details are missing.",
    });
  }

  await requireViewerSession();
  const selectedMode = await getSelectedMollieMode();
  await updateAlertStatus(parsed.data.alertId, parsed.data.status, selectedMode);

  revalidatePath("/");
  revalidatePath("/notifications");
  redirect(parsed.data.returnTo);
}

export async function markAllAlertsReadAction(formData: FormData) {
  const parsed = redirectSchema.safeParse({
    returnTo: formData.get("returnTo") || undefined,
  });

  if (!parsed.success) {
    redirectWithMessage("/notifications", {
      error: "Notification target is missing.",
    });
  }

  await requireViewerSession();
  const selectedMode = await getSelectedMollieMode();

  await getDb().execute(sql`
      update alerts
      set
        status = 'acknowledged',
        acknowledged_at = coalesce(acknowledged_at, now()),
        updated_at = now()
      where status = 'open'
        and id in (
          select a.id
          from alerts a
          left join payments p on p.id = a.payment_id
          left join subscriptions s on s.id = a.subscription_id
          left join customers c on c.id = coalesce(a.customer_id, p.customer_id, s.customer_id)
          where ${alertModeExpression} = ${selectedMode}
        )
    `);

  revalidatePath("/");
  revalidatePath("/notifications");
  redirect(parsed.data.returnTo);
}

export async function openAlertAction(formData: FormData) {
  const parsed = z
    .object({
      alertId: z.string().uuid(),
      redirectTo: z.string().trim().startsWith("/"),
    })
    .safeParse({
      alertId: formData.get("alertId"),
      redirectTo: formData.get("redirectTo"),
    });

  if (!parsed.success) {
    redirectWithMessage("/notifications", {
      error: "Alert target is missing.",
    });
  }

  await requireViewerSession();
  const selectedMode = await getSelectedMollieMode();
  await updateAlertStatus(parsed.data.alertId, "acknowledged", selectedMode);

  revalidatePath("/");
  revalidatePath("/notifications");
  redirect(parsed.data.redirectTo);
}
