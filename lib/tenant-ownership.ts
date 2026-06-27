import "server-only";

import { sql } from "drizzle-orm";

import { getDb, type DbClient } from "@/lib/db";
import { getSingleTenantIdOrThrow } from "@/lib/tenants";

type TenantLookupInput = {
  customerId?: string | null;
  mandateId?: string | null;
  paymentId?: string | null;
  paymentLinkId?: string | null;
  subscriptionId?: string | null;
};

async function resolveTenantIdForLinkedEntity(
  input: TenantLookupInput,
  client?: DbClient,
) {
  const db = client ?? getDb();
  const result = await db.execute<{ tenantId: string | null }>(sql`
    select coalesce(
      (
        select tenant_id
        from customers
        where id = ${input.customerId ?? null}
        limit 1
      ),
      (
        select tenant_id
        from mandates
        where id = ${input.mandateId ?? null}
        limit 1
      ),
      (
        select tenant_id
        from payments
        where id = ${input.paymentId ?? null}
        limit 1
      ),
      (
        select tenant_id
        from payment_links
        where id = ${input.paymentLinkId ?? null}
        limit 1
      ),
      (
        select tenant_id
        from subscriptions
        where id = ${input.subscriptionId ?? null}
        limit 1
      )
    ) as "tenantId"
  `);

  return result.rows[0]?.tenantId ?? null;
}

export async function requireTenantIdForLinkedEntity(
  input: TenantLookupInput,
  client?: DbClient,
) {
  const linkedTenantId = await resolveTenantIdForLinkedEntity(input, client);

  if (linkedTenantId) {
    return linkedTenantId;
  }

  return getSingleTenantIdOrThrow();
}

export async function requireCustomerTenantId(
  customerId: string,
  client?: DbClient,
) {
  return requireTenantIdForLinkedEntity({ customerId }, client);
}

export async function requireMandateTenantId(
  mandateId: string,
  client?: DbClient,
) {
  return requireTenantIdForLinkedEntity({ mandateId }, client);
}

export async function requirePaymentTenantId(
  paymentId: string,
  client?: DbClient,
) {
  return requireTenantIdForLinkedEntity({ paymentId }, client);
}

export async function requirePaymentLinkTenantId(
  paymentLinkId: string,
  client?: DbClient,
) {
  return requireTenantIdForLinkedEntity({ paymentLinkId }, client);
}

export async function requireSubscriptionTenantId(
  subscriptionId: string,
  client?: DbClient,
) {
  return requireTenantIdForLinkedEntity({ subscriptionId }, client);
}
