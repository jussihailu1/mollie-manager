import "server-only";

import { sql } from "drizzle-orm";

import { getDb, type DbClient } from "@/lib/db";
import { sendPlainEmail, notificationsAreConfigured } from "@/lib/notifications/email";
import { composeAlertEmail } from "@/lib/reliability/alert-email";
import { deliverAlertEmailWithDependencies } from "@/lib/reliability/alert-email-delivery";

type AlertSeverity = "critical" | "info" | "warning";

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
  const payload = JSON.stringify(input.payload ?? {});

  while (true) {
    const inserted = await db.execute<ExistingAlert>(sql`
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
        ${crypto.randomUUID()},
        ${input.severity},
        ${input.title},
        ${input.message},
        ${input.customerId ?? null},
        ${input.subscriptionId ?? null},
        ${input.paymentId ?? null},
        ${payload}::jsonb
      )
      on conflict do nothing
      returning id
    `);

    if (inserted.rows[0]?.id) {
      return {
        id: inserted.rows[0].id,
        isNew: true,
      };
    }

    const existing = await db.execute<ExistingAlert>(sql`
      select id
      from alerts
      where status in ('open', 'acknowledged')
        and title = ${input.title}
        and coalesce(payment_id, '') = coalesce(${input.paymentId ?? null}, '')
        and coalesce(subscription_id, '') = coalesce(${input.subscriptionId ?? null}, '')
      order by created_at, id
      limit 1
    `);

    if (existing.rows[0]?.id) {
      return {
        id: existing.rows[0].id,
        isNew: false,
      };
    }
  }
}

export async function deliverAlertEmail(input: {
  alertId: string;
  message: string;
  tenantId: string;
  title: string;
}) {
  return deliverAlertEmailWithDependencies(input, {
    composeAlertEmail,
    markAlertEmailSent: async (alertId) => {
      await getDb().execute(sql`
        update alerts
        set
          email_sent_at = now(),
          updated_at = now()
        where id = ${alertId}
      `);
    },
    notificationsAreConfigured,
    sendNotificationEmail: sendPlainEmail,
  });
}
