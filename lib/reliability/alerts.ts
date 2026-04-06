import "server-only";

import type { PoolClient } from "pg";

import { query } from "@/lib/db";
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
  client?: PoolClient,
) {
  if (!input.paymentId && !input.subscriptionId) {
    return;
  }

  const statement = `
    update alerts
    set
      status = 'resolved',
      resolved_at = now(),
      updated_at = now()
    where status = 'open'
      and ($1::text is null or payment_id = $1)
      and ($2::text is null or subscription_id = $2)
  `;
  const params = [input.paymentId ?? null, input.subscriptionId ?? null];

  if (client) {
    await client.query(statement, params);
    return;
  }

  await query(statement, params);
}

export async function openAlert(
  input: AlertInput,
  client?: PoolClient,
) {
  const existingStatement = `
    select id
    from alerts
    where status = 'open'
      and title = $1
      and coalesce(payment_id, '') = coalesce($2, '')
      and coalesce(subscription_id, '') = coalesce($3, '')
    limit 1
  `;
  const existingParams = [
    input.title,
    input.paymentId ?? null,
    input.subscriptionId ?? null,
  ];
  const existing = client
    ? await client.query<ExistingAlert>(existingStatement, existingParams)
    : await query<ExistingAlert>(existingStatement, existingParams);

  if (existing.rows[0]?.id) {
    return {
      id: existing.rows[0].id,
      isNew: false,
    };
  }

  const alertId = crypto.randomUUID();
  const statement = `
    insert into alerts (
      id,
      severity,
      title,
      message,
      customer_id,
      subscription_id,
      payment_id,
      payload
    ) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
  `;
  const params = [
    alertId,
    input.severity,
    input.title,
    input.message,
    input.customerId ?? null,
    input.subscriptionId ?? null,
    input.paymentId ?? null,
    JSON.stringify(input.payload ?? {}),
  ];

  if (client) {
    await client.query(statement, params);
  } else {
    await query(statement, params);
  }

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
    return false;
  }

  try {
    await sendPlainEmail({
      subject: `[Mollie Manager] ${input.title}`,
      text: `${input.title}\n\n${input.message}`,
    });

    await query(
      `
        update alerts
        set
          email_sent_at = now(),
          updated_at = now()
        where id = $1
      `,
      [input.alertId],
    );
  } catch {
    return false;
  }

  return true;
}
