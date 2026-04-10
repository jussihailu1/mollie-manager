import "server-only";

import { sql } from "drizzle-orm";

import { getDb, type DbClient } from "@/lib/db";
import { sendPlainEmail, notificationsAreConfigured } from "@/lib/notifications/email";

type AlertSeverity = "critical" | "warning";

type AlertInput = {
  customerId?: string | null;
  message: string;
  paymentId?: string | null;
  payload?: Record<string, unknown>;
  severity: AlertSeverity;
  subscriptionId?: string | null;
  title: string;
};

type ExistingAlert = {
  id: string;
};

export async function resolveAlertsForEntity(
  input: {
    paymentId?: string | null;
    subscriptionId?: string | null;
  },
  client?: DbClient,
) {
  if (!input.paymentId && !input.subscriptionId) {
    return;
  }

  const db = client ?? getDb();

  await db.execute(sql`
    update alerts
    set
      status = 'resolved',
      resolved_at = now(),
      updated_at = now()
    where status = 'open'
      and (${input.paymentId ?? null}::text is null or payment_id = ${input.paymentId ?? null})
      and (${input.subscriptionId ?? null}::text is null or subscription_id = ${input.subscriptionId ?? null})
  `);
}

export async function openAlert(
  input: AlertInput,
  client?: DbClient,
) {
  const db = client ?? getDb();
  const existing = await db.execute<ExistingAlert>(sql`
    select id
    from alerts
    where status = 'open'
      and title = ${input.title}
      and coalesce(payment_id, '') = coalesce(${input.paymentId ?? null}, '')
      and coalesce(subscription_id, '') = coalesce(${input.subscriptionId ?? null}, '')
    limit 1
  `);

  if (existing.rows[0]?.id) {
    return {
      id: existing.rows[0].id,
      isNew: false,
    };
  }

  const alertId = crypto.randomUUID();
  await db.execute(sql`
    insert into alerts (
      id,
      severity,
      title,
      message,
      customer_id,
      subscription_id,
      payment_id,
      payload
    ) values (
      ${alertId},
      ${input.severity},
      ${input.title},
      ${input.message},
      ${input.customerId ?? null},
      ${input.subscriptionId ?? null},
      ${input.paymentId ?? null},
      ${JSON.stringify(input.payload ?? {})}::jsonb
    )
  `);

  return {
    id: alertId,
    isNew: true,
  };
}

export async function deliverAlertEmail(input: {
  alertId: string;
  message: string;
  title: string;
}) {
  if (!notificationsAreConfigured()) {
    return {
      delivered: false,
      error: "Notifications are not configured.",
    };
  }

  try {
    await sendPlainEmail({
      subject: `[Mollie Manager] ${input.title}`,
      text: `${input.title}\n\n${input.message}`,
    });

    await getDb().execute(sql`
        update alerts
        set
          email_sent_at = now(),
          updated_at = now()
        where id = ${input.alertId}
      `);
  } catch (error) {
    return {
      delivered: false,
      error:
        error instanceof Error
          ? error.message.slice(0, 180)
          : "Email delivery failed.",
    };
  }

  return {
    delivered: true,
    error: null,
  };
}
