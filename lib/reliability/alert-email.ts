import "server-only";

import { sql } from "drizzle-orm";

import type { DbClient } from "@/lib/db";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import {
  buildAlertEmailContent,
  buildFallbackAlertEmailContent,
  type AlertEmailContext,
} from "@/lib/reliability/alert-email-template";

type AlertEmailContextRow = AlertEmailContext;

const alertModeExpression = sql<"live" | "test" | null>`
  coalesce(
    p.mode,
    s.mode,
    customer.mode,
    case
      when a.payload ->> 'mode' in ('test', 'live')
        then (a.payload ->> 'mode')::mollie_mode
      else null
    end
  )
`;

const customerBusinessNameExpression = sql<string | null>`
  coalesce(
    nullif(customer.metadata ->> 'businessName', ''),
    nullif(fallback_customer.metadata ->> 'businessName', ''),
    customer.full_name,
    fallback_customer.full_name
  )
`;

export async function getAlertEmailContext(
  alertId: string,
  client?: DbClient,
): Promise<AlertEmailContext | null> {
  const db = client ?? getDb();
  const result = await db.execute<AlertEmailContextRow>(sql`
    select
      a.id as "alertId",
      a.title,
      a.message,
      a.severity,
      a.created_at as "createdAt",
      p.id as "paymentId",
      p.mollie_payment_id as "paymentMollieId",
      p.mollie_status as "paymentStatus",
      p.amount_value as "paymentAmountValue",
      p.amount_currency as "paymentAmountCurrency",
      s.id as "subscriptionId",
      s.mollie_subscription_id as "subscriptionMollieId",
      s.local_status as "subscriptionLocalStatus",
      s.mollie_status as "subscriptionStatus",
      coalesce(customer.id, fallback_customer.id) as "customerId",
      ${customerBusinessNameExpression} as "customerName",
      coalesce(customer.email, fallback_customer.email) as "customerEmail",
      ${alertModeExpression} as "mode"
    from alerts a
    left join payments p on p.id = a.payment_id
    left join subscriptions s on s.id = a.subscription_id
    left join customers customer on customer.id = a.customer_id
    left join customers fallback_customer on fallback_customer.id = coalesce(p.customer_id, s.customer_id)
    where a.id = ${alertId}
    limit 1
  `);

  return result.rows[0] ?? null;
}

export async function composeAlertEmail(input: {
  alertId: string;
  message: string;
  title: string;
}) {
  const context = await getAlertEmailContext(input.alertId);

  if (!context) {
    return buildFallbackAlertEmailContent({
      message: input.message,
      title: input.title,
    });
  }

  return buildAlertEmailContent(context, env.APP_URL);
}
