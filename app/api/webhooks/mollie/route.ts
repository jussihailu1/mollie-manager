import { sql } from "drizzle-orm";

import type { MollieMode } from "@/lib/env";
import { getDb } from "@/lib/db";
import {
  deliverSubscriptionActivationNotificationsBatch,
  queueSubscriptionActivationExhaustedNotifications,
} from "@/lib/onboarding/subscription-activation-notifications";
import { openAlert } from "@/lib/reliability/alerts";
import {
  syncPaymentByMollieId,
  syncPaymentLinkByMollieId,
  syncSubscriptionByMollieId,
} from "@/lib/reliability/sync";
import {
  handleMollieWebhookRequest,
  type WebhookResourceSyncResult,
} from "@/lib/reliability/webhook-processing";

type ExistingResourceContext = {
  mode: "live" | "test";
  tenantId: string;
};

async function findExistingResourceContext(resourceId: string) {
  if (resourceId.startsWith("tr_")) {
    return (
      await getDb().execute<ExistingResourceContext>(sql`
        select mode, tenant_id as "tenantId"
        from payments
        where mollie_payment_id = ${resourceId}
        limit 1
      `)
    ).rows[0] ?? null;
  }

  if (resourceId.startsWith("sub_")) {
    return (
      await getDb().execute<ExistingResourceContext>(sql`
        select mode, tenant_id as "tenantId"
        from subscriptions
        where mollie_subscription_id = ${resourceId}
        limit 1
      `)
    ).rows[0] ?? null;
  }

  if (resourceId.startsWith("pl_")) {
    return (
      await getDb().execute<ExistingResourceContext>(sql`
        select mode, tenant_id as "tenantId"
        from payment_links
        where mollie_payment_link_id = ${resourceId}
        limit 1
      `)
    ).rows[0] ?? null;
  }

  return null;
}

async function processWebhookResource(
  resourceId: string,
  preferredMode: MollieMode | null,
  tenantId: string | null,
) {
  if (resourceId.startsWith("tr_")) {
    return syncPaymentByMollieId(resourceId, {
      actor: {
        kind: "system",
      },
      preferredMode: preferredMode ?? undefined,
      requireManagedResource: true,
      strictMode: Boolean(preferredMode),
      tenantId: tenantId ?? undefined,
    });
  }

  if (resourceId.startsWith("sub_")) {
    if (!preferredMode) {
      throw new Error("Subscription webhook is not linked to a managed local resource.");
    }

    return syncSubscriptionByMollieId(resourceId, {
      actor: {
        kind: "system",
      },
      preferredMode,
      strictMode: true,
      tenantId: tenantId ?? undefined,
    });
  }

  if (resourceId.startsWith("pl_")) {
    if (!preferredMode) {
      throw new Error("Payment-link webhook is not linked to a managed local resource.");
    }

    return syncPaymentLinkByMollieId(resourceId, {
      actor: {
        kind: "system",
      },
      preferredMode,
      requireManagedResource: true,
      strictMode: true,
      tenantId: tenantId ?? undefined,
    });
  }

  throw new Error("Unsupported webhook resource id.");
}

export async function POST(request: Request) {
  const webhookResources = new Map<string, { resourceId: string; tenantId: string | null }>();
  const result = await handleMollieWebhookRequest(request, {
    findExistingResourceContext,
    insertWebhookEvent: async (input) => {
      webhookResources.set(input.id, {
        resourceId: input.resourceId,
        tenantId: input.tenantId,
      });
      await getDb().execute(sql`
      insert into webhook_events (
        id,
        mode,
        tenant_id,
        resource_type,
        resource_id,
        topic,
        request_id,
        payload,
        processing_status
      ) values (
        ${input.id},
        ${input.mode},
        ${input.tenantId},
        ${input.resourceType ?? null},
        ${input.resourceId},
        ${input.topic},
        ${input.requestId},
        ${JSON.stringify(input.payload)}::jsonb,
        'pending'
      )
    `);
    },
    markWebhookEventFailed: async (input) => {
      const failed = await getDb().execute<{
        mode: MollieMode;
        retryCount: number;
        tenantId: string | null;
      }>(sql`
        update webhook_events
        set
          processing_status = 'failed',
          error_message = ${input.errorMessage},
          retry_count = retry_count + 1,
          last_attempt_at = now()
        where id = ${input.id}
        returning mode, retry_count as "retryCount", tenant_id as "tenantId"
      `);
      const resource = webhookResources.get(input.id);
      const tenantId = failed.rows[0]?.tenantId ?? resource?.tenantId ?? null;
      if (
        input.errorMessage.startsWith("Subscription activation is not ready:") &&
        failed.rows[0]?.retryCount >= 10 &&
        tenantId &&
        resource?.resourceId.startsWith("tr_")
      ) {
        const payment = await getDb().execute<{ customerId: string; id: string }>(sql`
          select id, customer_id as "customerId" from payments
          where mollie_payment_id = ${resource.resourceId} and tenant_id = ${tenantId}
          limit 1
        `);
        const customerId = payment.rows[0]?.customerId;
        if (customerId) {
          const alert = await openAlert({
            customerId,
            message: "Automatic subscription activation could not be completed after Mollie's webhook retry window. Review the customer and Mollie connection.",
            paymentId: payment.rows[0].id,
            payload: { webhookEventId: input.id },
            severity: "warning",
            tenantId,
            title: "Subscription activation requires review",
          });
          if (alert.isNew) {
            await queueSubscriptionActivationExhaustedNotifications({
              customerId,
              eventKey: `webhook:${resource.resourceId}`,
              mode: failed.rows[0].mode,
              tenantId,
            });
            await deliverSubscriptionActivationNotificationsBatch({
              limit: 100,
              mode: failed.rows[0].mode,
              tenantId,
            });
          }
        }
      }
    },
    markWebhookEventProcessed: async (input) => {
      const resourceResult: WebhookResourceSyncResult = input.result;

      await getDb().execute(sql`
        update webhook_events
        set
          tenant_id = coalesce(
            (select tenant_id from payments where id = ${resourceResult.paymentId} limit 1),
            (select tenant_id from subscriptions where id = ${resourceResult.subscriptionId} limit 1),
            (select tenant_id from payment_links where id = ${resourceResult.paymentLinkId} limit 1),
            tenant_id
          ),
          mode = coalesce(
            (select mode from payments where id = ${resourceResult.paymentId} limit 1),
            (select mode from subscriptions where id = ${resourceResult.subscriptionId} limit 1),
            (select mode from payment_links where id = ${resourceResult.paymentLinkId} limit 1),
            mode
          ),
          processing_status = 'processed',
          error_message = null,
          last_attempt_at = now(),
          processed_at = now()
        where id = ${input.id}
      `);
    },
    syncResource: processWebhookResource,
  });

  return new Response(result.body, {
    status: result.status,
  });
}
