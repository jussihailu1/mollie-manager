import "server-only";

import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { getTenantMollieClient, getTenantMollieRequestContext } from "@/lib/mollie/client";
import type { WebhookResourceContext } from "./webhook-processing";
import { discoverWebhookPaymentContext } from "./webhook-context-discovery";

export async function findExistingResourceContext(resourceId: string): Promise<WebhookResourceContext | null> {
  const result = await getDb().execute<WebhookResourceContext>(sql`
    select distinct mode, tenant_id as "tenantId" from (
      select mode, tenant_id from payments where mollie_payment_id = ${resourceId}
      union all
      select mode, tenant_id from subscriptions where mollie_subscription_id = ${resourceId}
      union all
      select mode, tenant_id from payment_links where mollie_payment_link_id = ${resourceId}
    ) managed
  `);
  if (result.rows.length > 1) throw new Error("Webhook resource ownership is ambiguous.");
  if (result.rows[0]) return result.rows[0];
  if (!resourceId.startsWith("tr_")) return null;

  const candidates = await getDb().execute<WebhookResourceContext>(sql`
    select distinct mode, tenant_id as "tenantId"
    from customers where mollie_customer_id is not null
  `);
  return discoverWebhookPaymentContext(resourceId, {
    candidates: candidates.rows,
    fetchPayment: async ({ tenantId, mode }) => {
      try {
        const client = await getTenantMollieClient(tenantId, mode);
        const { testmode, profileId } = await getTenantMollieRequestContext(tenantId, mode);
        const payment = await client.payments.get(resourceId, { ...(testmode ? { testmode } : {}) });
        if (profileId && payment.profileId !== profileId) return null;
        return payment;
      } catch {
        // A tenant may have no credentials for this mode, or not own this ID.
        // Intake remains unresolved; scheduled subscription discovery is fallback.
        return null;
      }
    },
    isManagedPayment: async (payment, { tenantId, mode }) => {
      const managed = await getDb().execute<{ id: string }>(sql`
        select c.id from customers c
        where c.tenant_id = ${tenantId} and c.mode = ${mode}
          and c.mollie_customer_id = ${payment.customerId}
          and (${payment.subscriptionId ?? null}::text is null or exists (
            select 1 from subscriptions s
            where s.tenant_id = c.tenant_id and s.mode = c.mode and s.customer_id = c.id
              and s.mollie_subscription_id = ${payment.subscriptionId ?? null}
          ))
      `);
      return managed.rows.length === 1;
    },
  });
}
