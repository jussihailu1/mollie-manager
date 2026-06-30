import "server-only";

import type { Payment } from "@mollie/api-client";
import { sql } from "drizzle-orm";

import { writeAuditLog } from "@/lib/audit";
import { getDb, transaction } from "@/lib/db";
import type { MollieMode } from "@/lib/env";
import { getTenantMollieClient } from "@/lib/mollie/client";
import {
  buildPaymentLinkSyncMetadata,
  derivePaymentLinkSyncAmount,
  derivePaymentLinkSyncStatus,
  type PaymentLinkSyncSource,
} from "@/lib/reliability/payment-link-sync-record";
import type { SyncActor } from "@/lib/reliability/sync-persistence";
import {
  getLocalCustomerByMollieId,
  getLocalPaymentLinkByMollieId,
} from "@/lib/reliability/sync-resource-state";
import {
  requireCustomerTenantId,
  requirePaymentLinkTenantId,
} from "@/lib/tenant-ownership";

type MolliePaymentLink = {
  createdAt?: string;
  description: string;
  expiresAt?: string;
  getPaymentUrl: () => string;
  getPayments: () => AsyncIterable<Payment>;
  id: string;
  webhookUrl?: string;
} & PaymentLinkSyncSource;

type LocalStoredPaymentLink = {
  customerId: string | null;
  id: string;
  metadata: Record<string, unknown>;
  molliePaymentLinkId: string | null;
};

export async function collectPaymentLinkPayments(paymentLink: MolliePaymentLink) {
  const payments: Payment[] = [];

  for await (const payment of paymentLink.getPayments()) {
    payments.push(payment);

    if (payments.length >= 50) {
      break;
    }
  }

  return payments;
}

export async function upsertPaymentLinkFromMollie(
  mode: MollieMode,
  paymentLink: MolliePaymentLink,
  payments: Payment[],
  options: {
    actor: SyncActor;
    customerId?: string | null;
    tenantId: string;
  },
) {
  const linkedCustomer =
    options.customerId ??
    (await getLocalCustomerByMollieId(mode, paymentLink.customerId, options.tenantId))?.id ??
    null;
  const localCustomer = linkedCustomer
    ? await getLocalCustomerByMollieId(mode, paymentLink.customerId, options.tenantId)
    : null;
  const paymentLinkAmount = derivePaymentLinkSyncAmount(paymentLink, payments);
  const paymentLinkStatus = derivePaymentLinkSyncStatus(paymentLink, payments);
  let localPaymentLinkId = crypto.randomUUID();

  await transaction(async (client) => {
    const existingPaymentLink = await getLocalPaymentLinkByMollieId(
      mode,
      paymentLink.id,
      client,
      options.tenantId,
    );
    const tenantId =
      localCustomer?.tenantId ??
      (linkedCustomer ? await requireCustomerTenantId(linkedCustomer, client) : null) ??
      (existingPaymentLink
        ? await requirePaymentLinkTenantId(existingPaymentLink.id, client)
        : null) ??
      options.tenantId;
    localPaymentLinkId = existingPaymentLink?.id ?? localPaymentLinkId;

    await client.execute(sql`
        insert into payment_links (
          id,
          tenant_id,
          customer_id,
          mode,
          mollie_payment_link_id,
          mollie_status,
          description,
          amount_value,
          amount_currency,
          checkout_url,
          expires_at,
          metadata,
          created_at,
          updated_at,
          last_synced_at
        ) values (
          ${localPaymentLinkId},
          ${tenantId},
          ${linkedCustomer ?? existingPaymentLink?.customerId ?? null},
          ${mode},
          ${paymentLink.id},
          ${paymentLinkStatus},
          ${paymentLink.description},
          ${paymentLinkAmount.value},
          ${paymentLinkAmount.currency},
          ${paymentLink.getPaymentUrl()},
          ${paymentLink.expiresAt ?? null}::timestamptz,
          ${JSON.stringify(
            buildPaymentLinkSyncMetadata({
              existingMetadata: existingPaymentLink?.metadata,
              paymentLink,
              payments,
            }),
          )}::jsonb,
          coalesce(${paymentLink.createdAt ?? null}::timestamptz, now()),
          now(),
          now()
        )
        on conflict (tenant_id, mode, mollie_payment_link_id)
        do update set
          customer_id = coalesce(excluded.customer_id, payment_links.customer_id),
          mollie_status = excluded.mollie_status,
          description = excluded.description,
          amount_value = excluded.amount_value,
          amount_currency = excluded.amount_currency,
          checkout_url = excluded.checkout_url,
          expires_at = excluded.expires_at,
          metadata = excluded.metadata,
          updated_at = now(),
          last_synced_at = now()
      `);

    await writeAuditLog(
      {
        action: "payment_link.sync",
        details: {
          localPaymentLinkId,
          molliePaymentLinkId: paymentLink.id,
          paymentCount: payments.length,
          paymentLinkStatus,
        },
        entityId: localPaymentLinkId,
        entityType: "payment_link",
        mode,
        outcome: "success",
        summary: "Refreshed a payment link from Mollie.",
      },
      client,
      options.actor,
    );
  });

  return localPaymentLinkId;
}

export async function syncMatchingPaymentLinkForPayment(
  mode: MollieMode,
  payment: Payment,
  customerId: string | null,
  actor: SyncActor,
  tenantId: string,
) {
  if (!customerId && !payment.customerId) {
    return null;
  }

  const candidates = await getDb().execute<LocalStoredPaymentLink>(sql`
      select
        id,
        customer_id as "customerId",
        mollie_payment_link_id as "molliePaymentLinkId"
      from payment_links
      where
        tenant_id = ${tenantId}
        mode = ${mode}
        and mollie_payment_link_id is not null
        and metadata ->> 'source' = 'subscription_onboarding'
        and metadata ->> 'paymentType' = 'first'
        and (
          customer_id = ${customerId}
          or metadata ->> 'mollieCustomerId' = ${payment.customerId ?? null}
        )
      order by created_at desc
      limit 10
    `);

  for (const candidate of candidates.rows) {
    if (!candidate.molliePaymentLinkId) {
      continue;
    }

    const mollie = await getTenantMollieClient(tenantId, mode);
    const paymentLink = (await mollie.paymentLinks.get(
      candidate.molliePaymentLinkId,
    )) as unknown as MolliePaymentLink;
    const payments = await collectPaymentLinkPayments(paymentLink);

    if (!payments.some((linkedPayment) => linkedPayment.id === payment.id)) {
      continue;
    }

    return upsertPaymentLinkFromMollie(mode, paymentLink, payments, {
      actor,
      customerId: candidate.customerId ?? customerId,
      tenantId,
    });
  }

  return null;
}
