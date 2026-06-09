import "server-only";

import { MandateStatus } from "@mollie/api-client";
import { sql } from "drizzle-orm";

import { writeAuditLog } from "@/lib/audit";
import { transaction, type DbTransaction } from "@/lib/db";
import type { MollieMode } from "@/lib/env";
import { getCustomerDetail } from "@/lib/onboarding/data";
import { getMollieClient } from "@/lib/mollie/client";
import { syncPaymentLinkByMollieId } from "@/lib/reliability/sync";
import { mapSubscriptionLifecycle } from "@/lib/subscriptions";

type LocalPaymentRecord = {
  id: string;
  molliePaymentId: string;
  paymentType: string;
};

type LocalSubscriptionRecord = {
  id: string;
  mollieSubscriptionId: string;
};

export type CustomerRepairResult = {
  customerId: string;
  mandateCount: number;
  paymentCount: number;
  paymentLinkCount: number;
  status: "repaired" | "skipped";
  subscriptionCount: number;
  reason?: "archived" | "missing_customer" | "not_linked";
};

type RepairActor = {
  email?: string | null;
  kind: "system" | "user";
};

async function getLocalPayments(customerId: string, client: DbTransaction) {
  const result = await client.execute<LocalPaymentRecord>(sql`
      select
        id,
        mollie_payment_id as "molliePaymentId",
        payment_type as "paymentType"
      from payments
      where customer_id = ${customerId} and mollie_payment_id is not null
      order by created_at desc
    `);

  return result.rows;
}

async function getLocalSubscriptions(customerId: string, client: DbTransaction) {
  const result = await client.execute<LocalSubscriptionRecord>(sql`
      select
        id,
        mollie_subscription_id as "mollieSubscriptionId"
      from subscriptions
      where customer_id = ${customerId} and mollie_subscription_id is not null
      order by created_at desc
    `);

  return result.rows;
}

async function upsertMandate(
  client: DbTransaction,
  customerId: string,
  mode: MollieMode,
  mandate: {
    createdAt?: string | null;
    details?: unknown;
    id: string;
    method?: string | null;
    status?: string | null;
  },
) {
  const existing = await client.execute<{ id: string }>(sql`
      select id
      from mandates
      where mode = ${mode} and mollie_mandate_id = ${mandate.id}
      limit 1
    `);

  const localMandateId = existing.rows[0]?.id ?? crypto.randomUUID();

  await client.execute(sql`
      insert into mandates (
        id,
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
        ${customerId},
        ${mode},
        ${mandate.id},
        ${mandate.method ?? null},
        ${mandate.status ?? null},
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
      on conflict (mode, mollie_mandate_id)
      do update set
        customer_id = excluded.customer_id,
        method = excluded.method,
        mollie_status = excluded.mollie_status,
        is_valid = excluded.is_valid,
        details = excluded.details,
        updated_at = now(),
        last_synced_at = now()
    `);

  return localMandateId;
}

export async function repairCustomerBillingState(input: {
  actor?: RepairActor;
  customerId: string;
  mode: "live" | "test";
}): Promise<CustomerRepairResult> {
  const actor = input.actor ?? {
    kind: "system" as const,
  };
  const customerDetail = await getCustomerDetail(input.customerId, input.mode);
  if (!customerDetail) {
    return {
      customerId: input.customerId,
      mandateCount: 0,
      paymentCount: 0,
      paymentLinkCount: 0,
      status: "skipped",
      reason: "missing_customer",
      subscriptionCount: 0,
    };
  }

  const customer = customerDetail.customer;

  if (!customer.mollieCustomerId) {
    return {
      customerId: customer.id,
      mandateCount: 0,
      paymentCount: 0,
      paymentLinkCount: 0,
      status: "skipped",
      reason: "not_linked",
      subscriptionCount: 0,
    };
  }

  const mollieCustomerId = customer.mollieCustomerId;

  if (customer.archivedAt) {
    return {
      customerId: customer.id,
      mandateCount: 0,
      paymentCount: 0,
      paymentLinkCount: 0,
      status: "skipped",
      reason: "archived",
      subscriptionCount: 0,
    };
  }

  const mollie = getMollieClient(input.mode);
  const mandates = await mollie.customerMandates.page({
    customerId: mollieCustomerId,
  });

  await transaction(async (client) => {
    const mandateIdMap = new Map<string, string>();

    for (const mandate of mandates) {
      const localMandateId = await upsertMandate(client, customer.id, customer.mode, {
        createdAt: mandate.createdAt,
        details: mandate.details,
        id: mandate.id,
        method: mandate.method,
        status: mandate.status,
      });

      mandateIdMap.set(mandate.id, localMandateId);
    }

    const localPayments = await getLocalPayments(customer.id, client);

    for (const localPayment of localPayments) {
      const payment = await mollie.payments.get(localPayment.molliePaymentId);
      const linkedMandateId = payment.mandateId
        ? mandateIdMap.get(payment.mandateId) ?? null
        : null;

      await client.execute(sql`
          update payments
          set
            mandate_id = ${linkedMandateId},
            mollie_status = ${payment.status},
            sequence_type = ${payment.sequenceType},
            method = ${payment.method ?? null},
            checkout_url = ${payment.getCheckoutUrl()},
            expires_at = ${payment.expiresAt ?? null}::timestamptz,
            paid_at = ${payment.paidAt ?? null}::timestamptz,
            failed_at = ${payment.failedAt ?? null}::timestamptz,
            updated_at = now(),
            last_synced_at = now()
          where id = ${localPayment.id}
        `);
    }

    const localSubscriptions = await getLocalSubscriptions(customer.id, client);

    for (const localSubscription of localSubscriptions) {
      const subscription = (await mollie.customerSubscriptions.get(
        localSubscription.mollieSubscriptionId,
        {
          customerId: mollieCustomerId,
        },
      )) as unknown as {
        status: string;
      };

      await client.execute(sql`
          update subscriptions
          set
            mollie_status = ${subscription.status},
            local_status = ${mapSubscriptionLifecycle(subscription.status)},
            updated_at = now(),
            last_synced_at = now()
          where id = ${localSubscription.id}
        `);
    }

    await client.execute(sql`
        update customers
        set
          updated_at = now(),
          last_synced_at = now()
        where id = ${customer.id}
      `);

    await writeAuditLog(
      {
        action: "customer.repair",
        details: {
          localCustomerId: customer.id,
          mandateCount: mandates.length,
          paymentLinkCount: customerDetail?.paymentLinks.length ?? 0,
        },
        entityId: customer.id,
        entityType: "customer",
        mode: customer.mode,
        outcome: "success",
        summary: "Repaired the customer graph from Mollie.",
      },
      client,
      actor,
    );
  });

  for (const paymentLink of customerDetail.paymentLinks) {
    if (!paymentLink.molliePaymentLinkId) {
      continue;
    }

    await syncPaymentLinkByMollieId(paymentLink.molliePaymentLinkId, {
      actor,
      preferredMode: input.mode,
      strictMode: true,
    });
  }

  return {
    customerId: customer.id,
    mandateCount: mandates.length,
    paymentCount: customerDetail.payments.length,
    paymentLinkCount: customerDetail.paymentLinks.length,
    status: "repaired",
    subscriptionCount: customerDetail.subscriptions.length,
  };
}
