"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { z } from "zod";

import { writeAuditLog } from "@/lib/audit";
import { requireViewerSession } from "@/lib/auth/session";
import { getSelectedMollieMode } from "@/lib/dashboard-mode";
import { query, transaction } from "@/lib/db";
import { env } from "@/lib/env";
import { notificationsAreConfigured } from "@/lib/notifications/email";
import { deliverAlertEmail } from "@/lib/reliability/alerts";
import {
  reconcileOperationalData,
  syncPaymentByMollieId,
  syncSubscriptionByMollieId,
} from "@/lib/reliability/sync";

const redirectSchema = z.object({
  returnTo: z.string().trim().startsWith("/").default("/settings"),
});

const replayWebhookSchema = redirectSchema.extend({
  webhookEventId: z.string().uuid(),
});

type StoredWebhookEvent = {
  id: string;
  resourceId: string | null;
  resourceType: string | null;
};

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

  return "Something went wrong while processing the reliability task.";
}

async function processStoredWebhookResource(resourceId: string) {
  if (resourceId.startsWith("tr_")) {
    return syncPaymentByMollieId(resourceId, {
      actor: {
        kind: "system",
      },
    });
  }

  if (resourceId.startsWith("sub_")) {
    return syncSubscriptionByMollieId(resourceId, {
      actor: {
        kind: "system",
      },
    });
  }

  throw new Error("Unsupported webhook resource id.");
}

export async function runReconciliationAction(formData: FormData) {
  const parsed = redirectSchema.safeParse({
    returnTo: formData.get("returnTo"),
  });

  if (!parsed.success) {
    redirectWithMessage("/settings", {
      error: "Reconciliation target is missing.",
    });
  }

  const session = await requireViewerSession();

  try {
    const result = await reconcileOperationalData({
      email: session.user.email ?? null,
      kind: "user",
    });

    revalidatePath("/settings");
    revalidatePath("/alerts");
    revalidatePath("/payments");
    revalidatePath("/subscriptions");
    revalidatePath("/customers");
    redirectWithMessage(parsed.data.returnTo, {
      notice: `Reconciliation complete. Checked ${result.subscriptionsChecked} subscriptions and ${result.firstPaymentsChecked} first payments.`,
    });
  } catch (error) {
    unstable_rethrow(error);
    redirectWithMessage(parsed.data.returnTo, {
      error: serializeError(error),
    });
  }
}

export async function replayWebhookEventAction(formData: FormData) {
  const parsed = replayWebhookSchema.safeParse({
    returnTo: formData.get("returnTo"),
    webhookEventId: formData.get("webhookEventId"),
  });

  if (!parsed.success) {
    redirectWithMessage("/settings", {
      error: "Webhook event id is missing.",
    });
  }

  await requireViewerSession();

  const result = await query<StoredWebhookEvent>(
    `
      select
        id,
        resource_id as "resourceId",
        resource_type as "resourceType"
      from webhook_events
      where id = $1
      limit 1
    `,
    [parsed.data.webhookEventId],
  );
  const event = result.rows[0];

  if (!event?.resourceId) {
    redirectWithMessage(parsed.data.returnTo, {
      error: "Webhook event resource could not be replayed.",
    });
  }

  try {
    await processStoredWebhookResource(event.resourceId);

    await query(
      `
        update webhook_events
        set
          processing_status = 'processed',
          error_message = null,
          retry_count = retry_count + 1,
          last_attempt_at = now(),
          processed_at = now()
        where id = $1
      `,
      [event.id],
    );

    revalidatePath("/settings");
    revalidatePath("/alerts");
    revalidatePath("/payments");
    revalidatePath("/subscriptions");
    redirectWithMessage(parsed.data.returnTo, {
      notice: "Webhook event replayed successfully.",
    });
  } catch (error) {
    unstable_rethrow(error);
    await query(
      `
        update webhook_events
        set
          processing_status = 'failed',
          error_message = $2,
          retry_count = retry_count + 1,
          last_attempt_at = now()
        where id = $1
      `,
      [event.id, serializeError(error)],
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
    redirectWithMessage("/settings", {
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
    await client.query(
      `
        insert into alerts (
          id,
          severity,
          title,
          message,
          payload
        ) values ($1, 'info', $2, $3, $4::jsonb)
      `,
      [
        alertId,
        title,
        message,
        JSON.stringify({
          kind: "manual_test",
          mode: selectedMode,
          requestedAt,
          requestedBy: session.user.email ?? null,
        }),
      ],
    );
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

  revalidatePath("/settings");
  revalidatePath("/alerts");

  if (!delivered) {
    redirectWithMessage(parsed.data.returnTo, {
      error: delivery.error
        ? `The test alert was stored locally, but SMTP delivery failed: ${delivery.error}`
        : "The test alert was stored locally, but the email could not be delivered. Review the SMTP settings and try again.",
    });
  }

  redirectWithMessage(parsed.data.returnTo, {
    notice: "Test alert sent. Check your inbox and the Alerts page.",
  });
}
