import "server-only";

import { sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { env, type MollieMode } from "@/lib/env";
import { sendEmailTo } from "@/lib/notifications/email";

type ActivationEmailContext = {
  amountValue: string | null;
  customerEmail: string | null;
  customerName: string | null;
  interval: string | null;
  nextPaymentDate: string | null;
  subscriptionId: string | null;
};

const retryDelayMs = 60 * 60 * 1_000;

export async function queueSubscriptionActivationSuccessNotifications(input: {
  customerId: string;
  mode: MollieMode;
  subscriptionId: string;
  tenantId: string;
}) {
  const db = getDb();
  const context = await db.execute<ActivationEmailContext>(sql`
    select s.id as "subscriptionId", s.amount_value::text as "amountValue", s.interval,
      s.metadata ->> 'nextPaymentDate' as "nextPaymentDate",
      c.email as "customerEmail", coalesce(nullif(c.metadata ->> 'businessName', ''), c.full_name) as "customerName"
    from subscriptions s join customers c on c.id = s.customer_id and c.tenant_id = s.tenant_id
    where s.id = ${input.subscriptionId} and s.tenant_id = ${input.tenantId} and s.mode = ${input.mode}
    limit 1
  `);
  const row = context.rows[0];
  if (!row) return;
  const recipients = await db.execute<{ email: string }>(sql`
    select distinct operator_email as email from operator_tenant_memberships where tenant_id = ${input.tenantId}
  `);
  const insert = async (notificationType: string, recipientEmail: string, subject: string) => {
    await db.execute(sql`
      insert into subscription_activation_notifications (id, tenant_id, customer_id, subscription_id, mode, notification_type, event_key, recipient_email, subject)
      values (${crypto.randomUUID()}, ${input.tenantId}, ${input.customerId}, ${input.subscriptionId}, ${input.mode}, ${notificationType}, ${`subscription:${input.subscriptionId}`}, ${recipientEmail}, ${subject})
      on conflict (tenant_id, mode, notification_type, event_key, recipient_email) do nothing
    `);
  };
  if (row.customerEmail) await insert("customer_activated", row.customerEmail, "Your subscription is active");
  await Promise.all(recipients.rows.map((recipient) => insert("tenant_activated", recipient.email, `Subscription activated for ${row.customerName ?? "customer"}`)));
}

export async function queueSubscriptionActivationExhaustedNotifications(input: { customerId: string; eventKey: string; jobId?: string; mode: MollieMode; tenantId: string }) {
  const db = getDb();
  const recipients = await db.execute<{ email: string }>(sql`select distinct operator_email as email from operator_tenant_memberships where tenant_id = ${input.tenantId}`);
  await Promise.all(recipients.rows.map((recipient) => db.execute(sql`
    insert into subscription_activation_notifications (id, tenant_id, customer_id, job_id, mode, notification_type, event_key, recipient_email, subject)
    values (${crypto.randomUUID()}, ${input.tenantId}, ${input.customerId}, ${input.jobId ?? null}, ${input.mode}, 'tenant_activation_exhausted', ${input.eventKey}, ${recipient.email}, 'Subscription activation requires review')
    on conflict (tenant_id, mode, notification_type, event_key, recipient_email) do nothing
  `)));
}

function body(row: ActivationEmailContext & { notificationType: string }) {
  const details = [
    `Amount: ${row.amountValue ?? "as agreed"} EUR`,
    `Interval: ${row.interval ?? "as agreed"}`,
    row.nextPaymentDate ? `Next collection: ${row.nextPaymentDate}` : null,
  ].filter(Boolean).join("\n");
  if (row.notificationType === "customer_activated") {
    const contact = env.SUBSCRIPTION_CANCELLATION_EMAIL ? `\nFor cancellation questions, contact ${env.SUBSCRIPTION_CANCELLATION_EMAIL}.` : "";
    return { text: `Your subscription is now active.\n\n${details}${contact}`, html: `<p>Your subscription is now active.</p><p>${details.replaceAll("\n", "<br />")}</p>${contact ? `<p>For cancellation questions, contact ${env.SUBSCRIPTION_CANCELLATION_EMAIL}.</p>` : ""}` };
  }
  if (row.notificationType === "tenant_activation_exhausted") {
    return { text: `Automatic subscription activation for ${row.customerName ?? "customer"} could not be completed within 24 hours. Review the customer and Mollie connection in Kify.`, html: `<p>Automatic subscription activation for ${row.customerName ?? "customer"} could not be completed within 24 hours.</p><p>Review the customer and Mollie connection in Kify.</p>` };
  }
  return { text: `Subscription activated for ${row.customerName ?? "customer"}.\n\n${details}\nSubscription: ${row.subscriptionId}`, html: `<p>Subscription activated for ${row.customerName ?? "customer"}.</p><p>${details.replaceAll("\n", "<br />")}</p><p>Subscription: ${row.subscriptionId}</p>` };
}

export async function deliverSubscriptionActivationNotificationsBatch(input: { limit: number; mode: MollieMode; tenantId: string }) {
  const db = getDb();
  const claimed = await db.execute<(ActivationEmailContext & { claimToken: string; id: string; notificationType: string; recipientEmail: string; subject: string })>(sql`
    with candidates as (
      select id, subscription_id, customer_id from subscription_activation_notifications
      where tenant_id = ${input.tenantId} and mode = ${input.mode} and status in ('pending', 'failed') and next_attempt_at <= now()
      order by created_at asc limit ${input.limit} for update skip locked
    ) update subscription_activation_notifications n set status = 'claimed', claim_token = ${crypto.randomUUID()}, claimed_at = now(), attempt_count = n.attempt_count + 1, updated_at = now()
    from candidates c
      left join subscriptions s on s.id = c.subscription_id and s.tenant_id = ${input.tenantId}
      left join customers customer on customer.id = c.customer_id and customer.tenant_id = ${input.tenantId}
    where n.id = c.id
    returning n.id, n.claim_token as "claimToken", n.notification_type as "notificationType", n.recipient_email as "recipientEmail", n.subject,
      s.id as "subscriptionId", s.amount_value::text as "amountValue", s.interval, s.metadata ->> 'nextPaymentDate' as "nextPaymentDate",
      customer.email as "customerEmail", coalesce(nullif(customer.metadata ->> 'businessName', ''), customer.full_name) as "customerName"
  `);
  let sentCount = 0; let failedCount = 0;
  for (const row of claimed.rows) {
    try {
      const content = body(row);
      await sendEmailTo({ to: row.recipientEmail, subject: row.subject, text: content.text, html: content.html });
      await db.execute(sql`update subscription_activation_notifications set status = 'sent', sent_at = now(), updated_at = now() where id = ${row.id} and claim_token = ${row.claimToken}`);
      sentCount += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 180) : "Email delivery failed.";
      await db.execute(sql`update subscription_activation_notifications set status = 'failed', last_error_message = ${message}, next_attempt_at = now() + (${retryDelayMs} * interval '1 millisecond'), updated_at = now() where id = ${row.id} and claim_token = ${row.claimToken}`);
      failedCount += 1;
    }
  }
  return { attemptedCount: claimed.rows.length, failedCount, sentCount };
}
