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
  tenantId: string;
  title: string;
};

type ExistingAlert = {
  id: string;
};

function buildStoredAlertPayload(input: AlertInput) {
  return JSON.stringify({
    ...(input.payload ?? {}),
    tenantId: input.tenantId,
  });
}

function alertTenantScopePredicate(tenantId: string) {
  return sql`
    (
      coalesce(alert.payload ->> 'tenantId', '') = ${tenantId}
      or exists (
        select 1
        from payments p
        where p.id = alert.payment_id
          and p.tenant_id = ${tenantId}
      )
      or exists (
        select 1
        from subscriptions s
        where s.id = alert.subscription_id
          and s.tenant_id = ${tenantId}
      )
      or exists (
        select 1
        from customers c
        where c.id = alert.customer_id
          and c.tenant_id = ${tenantId}
      )
    )
  `;
}

export async function resolveAlertsForEntity(
  input: {
    paymentId?: string | null;
    subscriptionId?: string | null;
    tenantId: string;
  },
  client?: DbClient,
) {
  if (!input.paymentId && !input.subscriptionId) {
    return;
  }

  const db = client ?? getDb();

  await db.execute(sql`
    update alerts as alert
    set
      status = 'resolved',
      resolved_at = now(),
      updated_at = now()
    where status = 'open'
      and (${input.paymentId ?? null}::text is null or payment_id = ${input.paymentId ?? null})
      and (${input.subscriptionId ?? null}::text is null or subscription_id = ${input.subscriptionId ?? null})
      and ${alertTenantScopePredicate(input.tenantId)}
  `);
}

export async function openAlert(
  input: AlertInput,
  client?: DbClient,
) {
  const db = client ?? getDb();
  const payload = buildStoredAlertPayload(input);

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
      select alert.id
      from alerts as alert
      where alert.status in ('open', 'acknowledged')
        and alert.title = ${input.title}
        and coalesce(alert.customer_id, '') = coalesce(${input.customerId ?? null}, '')
        and coalesce(alert.payment_id, '') = coalesce(${input.paymentId ?? null}, '')
        and coalesce(alert.subscription_id, '') = coalesce(${input.subscriptionId ?? null}, '')
        and ${alertTenantScopePredicate(input.tenantId)}
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
        update alerts as alert
        set
          email_sent_at = now(),
          updated_at = now()
        where id = ${alertId}
          and ${alertTenantScopePredicate(input.tenantId)}
      `);
    },
    notificationsAreConfigured,
    sendNotificationEmail: sendPlainEmail,
  });
}
