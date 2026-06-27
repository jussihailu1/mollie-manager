import "server-only";

import { MandateStatus } from "@mollie/api-client";
import { sql } from "drizzle-orm";

import { getDb, type DbClient, type DbTransaction } from "@/lib/db";
import type { MollieMode } from "@/lib/env";
import { getMollieClient } from "@/lib/mollie/client";
import { getSingleTenantIdOrThrow } from "@/lib/tenants";
import type {
  CancellationRequestSubscription,
  WithdrawableOperationRequest,
} from "@/lib/subscription-operation-requests";

type LocalCustomerLink = {
  id: string;
  mollieCustomerId: string | null;
  mode: MollieMode;
  tenantId: string;
};

type LocalSubscriptionLink = {
  customerId: string;
  customerMollieId: string | null;
  id: string;
  localStatus: string;
  mandateId: string | null;
  metadata: Record<string, unknown>;
  mode: MollieMode;
  mollieSubscriptionId: string | null;
  subscriptionTermMode: "fixed_term" | "open_ended";
  tenantId: string;
  totalPayments: number | null;
};

type LocalStoredPaymentLink = {
  customerId: string | null;
  id: string;
  metadata: Record<string, unknown>;
  molliePaymentLinkId: string | null;
  tenantId: string;
};

type LocalMandateLink = {
  id: string;
};

export type SyncResourceCustomerLink = LocalCustomerLink;
export type SyncResourceSubscriptionLink = LocalSubscriptionLink;
export type SyncResourceStoredPaymentLink = LocalStoredPaymentLink;

async function resolveTenantId(tenantId?: string) {
  return tenantId ?? (await getSingleTenantIdOrThrow());
}

export async function getLocalCustomerByMollieId(
  mode: MollieMode,
  mollieCustomerId: string | undefined,
  tenantId?: string,
) {
  if (!mollieCustomerId) {
    return null;
  }

  const resolvedTenantId = await resolveTenantId(tenantId);
  const result = await getDb().execute<LocalCustomerLink>(sql`
      select
        id,
        mode,
        tenant_id as "tenantId",
        mollie_customer_id as "mollieCustomerId"
      from customers
      where tenant_id = ${resolvedTenantId}
        and mode = ${mode}
        and mollie_customer_id = ${mollieCustomerId}
      limit 1
    `);

  return result.rows[0] ?? null;
}

export async function getManagedSubscription(
  subscriptionId: string,
  tenantId?: string,
) {
  const resolvedTenantId = await resolveTenantId(tenantId);
  const result = await getDb().execute<LocalSubscriptionLink>(sql`
      select
        s.id,
        s.mode,
        s.tenant_id as "tenantId",
        s.local_status as "localStatus",
        s.mandate_id as "mandateId",
        s.mollie_subscription_id as "mollieSubscriptionId",
        s.subscription_term_mode as "subscriptionTermMode",
        s.total_payments as "totalPayments",
        s.metadata,
        c.id as "customerId",
        c.mollie_customer_id as "customerMollieId"
      from subscriptions s
      inner join customers c on c.id = s.customer_id
      where s.id = ${subscriptionId}
        and s.tenant_id = ${resolvedTenantId}
        and c.tenant_id = ${resolvedTenantId}
      limit 1
    `);

  return result.rows[0] ?? null;
}

export async function lockCancellationRequestSubscription(
  client: DbTransaction,
  subscriptionId: string,
  mode: MollieMode,
  tenantId?: string,
) {
  const resolvedTenantId = await resolveTenantId(tenantId);
  const result = await client.execute<CancellationRequestSubscription>(sql`
    select
      local_status as "localStatus",
      mollie_status as "mollieStatus",
      subscription_term_mode as "termMode",
      cancellation_effect as "cancellationEffect",
      service_end_at as "serviceEndAt",
      customer_id as "customerId"
    from subscriptions
    where id = ${subscriptionId}
      and tenant_id = ${resolvedTenantId}
      and mode = ${mode}
    for update
  `);

  return result.rows[0] ?? null;
}

export async function lockManagedOperationRequest(
  client: DbTransaction,
  operationRequestId: string,
  mode: MollieMode,
  tenantId?: string,
) {
  const resolvedTenantId = await resolveTenantId(tenantId);
  const result = await client.execute<WithdrawableOperationRequest>(sql`
    select
      sor.id,
      sor.operation,
      sor.status,
      sor.subscription_id as "subscriptionId",
      s.customer_id as "customerId"
    from subscription_operation_requests sor
    inner join subscriptions s
      on s.id = sor.subscription_id
      and s.tenant_id = sor.tenant_id
      and s.mode = sor.mode
    where sor.id = ${operationRequestId}
      and sor.tenant_id = ${resolvedTenantId}
      and s.tenant_id = ${resolvedTenantId}
      and sor.mode = ${mode}
    for update
  `);

  return result.rows[0] ?? null;
}

export async function getManagedSubscriptionByMollieId(
  mode: MollieMode,
  mollieSubscriptionId: string | undefined,
  tenantId?: string,
) {
  if (!mollieSubscriptionId) {
    return null;
  }

  const resolvedTenantId = await resolveTenantId(tenantId);
  const result = await getDb().execute<LocalSubscriptionLink>(sql`
      select
        s.id,
        s.mode,
        s.tenant_id as "tenantId",
        s.local_status as "localStatus",
        s.mandate_id as "mandateId",
        s.mollie_subscription_id as "mollieSubscriptionId",
        s.subscription_term_mode as "subscriptionTermMode",
        s.total_payments as "totalPayments",
        s.metadata,
        c.id as "customerId",
        c.mollie_customer_id as "customerMollieId"
      from subscriptions s
      inner join customers c on c.id = s.customer_id
      where s.tenant_id = ${resolvedTenantId}
        and c.tenant_id = ${resolvedTenantId}
        and s.mode = ${mode}
        and s.mollie_subscription_id = ${mollieSubscriptionId}
      limit 1
    `);

  return result.rows[0] ?? null;
}

export async function getLocalPaymentLinkByMollieId(
  mode: MollieMode,
  molliePaymentLinkId: string,
  client?: DbClient,
  tenantId?: string,
) {
  const db = client ?? getDb();
  const resolvedTenantId = await resolveTenantId(tenantId);
  const result = await db.execute<LocalStoredPaymentLink>(sql`
      select
        id,
        customer_id as "customerId",
        metadata,
        mollie_payment_link_id as "molliePaymentLinkId",
        tenant_id as "tenantId"
      from payment_links
      where tenant_id = ${resolvedTenantId}
        and mode = ${mode}
        and mollie_payment_link_id = ${molliePaymentLinkId}
      limit 1
    `);

  const row = result.rows[0];

  if (!row) {
    return null;
  }

  return {
    ...row,
    metadata:
      typeof row.metadata === "object" && row.metadata !== null ? row.metadata : {},
  } satisfies LocalStoredPaymentLink;
}

export async function findLocalMandateId(
  mode: MollieMode,
  mollieMandateId: string | undefined,
  client?: DbClient,
  tenantId?: string,
) {
  if (!mollieMandateId) {
    return null;
  }

  const db = client ?? getDb();
  const resolvedTenantId = await resolveTenantId(tenantId);
  const result = await db.execute<LocalMandateLink>(sql`
    select id
    from mandates
    where tenant_id = ${resolvedTenantId}
      and mode = ${mode}
      and mollie_mandate_id = ${mollieMandateId}
    limit 1
  `);

  return result.rows[0]?.id ?? null;
}

export async function upsertMandatesForCustomer(
  client: DbTransaction,
  customer: LocalCustomerLink,
) {
  if (!customer.mollieCustomerId) {
    return new Map<string, string>();
  }

  const mandates = await getMollieClient(customer.mode).customerMandates.page({
    customerId: customer.mollieCustomerId,
  });
  const mandateIdMap = new Map<string, string>();

  for (const mandate of mandates) {
    const existing = await client.execute<LocalMandateLink>(sql`
        select id
        from mandates
        where tenant_id = ${customer.tenantId}
          and mode = ${customer.mode}
          and mollie_mandate_id = ${mandate.id}
        limit 1
      `);
    const localMandateId = existing.rows[0]?.id ?? crypto.randomUUID();

    await client.execute(sql`
        insert into mandates (
          id,
          tenant_id,
          customer_id,
          mode,
          mollie_mandate_id,
          method,
          mollie_status,
          is_valid,
          details,
          created_at,
          updated_at,
          last_synced_at
        ) values (
          ${localMandateId},
          ${customer.tenantId},
          ${customer.id},
          ${customer.mode},
          ${mandate.id},
          ${mandate.method ?? null},
          ${mandate.status},
          ${mandate.status === MandateStatus.valid},
          ${JSON.stringify(
            typeof mandate.details === "object" && mandate.details !== null
              ? mandate.details
              : {},
          )}::jsonb,
          coalesce(${mandate.createdAt ?? null}::timestamptz, now()),
          now(),
          now()
        )
        on conflict (tenant_id, mode, mollie_mandate_id)
        do update set
          customer_id = excluded.customer_id,
          method = excluded.method,
          mollie_status = excluded.mollie_status,
          is_valid = excluded.is_valid,
          details = excluded.details,
          updated_at = now(),
          last_synced_at = now()
      `);

    mandateIdMap.set(mandate.id, localMandateId);
  }

  return mandateIdMap;
}
