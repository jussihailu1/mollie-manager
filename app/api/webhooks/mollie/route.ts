import { sql } from "drizzle-orm";

import type { MollieMode } from "@/lib/env";
import { getDb } from "@/lib/db";
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
  const result = await handleMollieWebhookRequest(request, {
    findExistingResourceContext,
    insertWebhookEvent: async (input) => {
      await getDb().execute(sql`
      insert into webhook_events (
        id,
        mode,
        resource_type,
        resource_id,
        topic,
        request_id,
        payload,
        processing_status
      ) values (
        ${input.id},
        ${input.mode},
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
      await getDb().execute(sql`
        update webhook_events
        set
          processing_status = 'failed',
          error_message = ${input.errorMessage},
          retry_count = retry_count + 1,
          last_attempt_at = now()
        where id = ${input.id}
      `);
    },
    markWebhookEventProcessed: async (input) => {
      const resourceResult: WebhookResourceSyncResult = input.result;

      await getDb().execute(sql`
        update webhook_events
        set
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
