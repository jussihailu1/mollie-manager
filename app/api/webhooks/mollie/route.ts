import { sql } from "drizzle-orm";

import type { MollieMode } from "@/lib/env";
import { getDb } from "@/lib/db";
import {
  syncPaymentByMollieId,
  syncPaymentLinkByMollieId,
  syncSubscriptionByMollieId,
} from "@/lib/reliability/sync";

type ExistingResourceMode = {
  mode: "live" | "test";
};

const supportedResourceIdPattern = /^(tr|sub|pl)_[A-Za-z0-9]+$/;

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return error.message.slice(0, 180);
  }

  return "Webhook processing failed.";
}

async function parseWebhookRequest(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const payload = (await request.json()) as Record<string, unknown>;

    return {
      payload,
      resourceId:
        typeof payload.id === "string"
          ? payload.id
          : typeof payload.resourceId === "string"
            ? payload.resourceId
            : null,
      resourceType:
        typeof payload.resource === "string"
          ? payload.resource
          : typeof payload.resourceType === "string"
            ? payload.resourceType
            : null,
    };
  }

  const formData = await request.formData();
  const payload = Object.fromEntries(formData.entries());
  const resourceId = formData.get("id");
  const resourceType = formData.get("resource");

  return {
    payload,
    resourceId: typeof resourceId === "string" ? resourceId : null,
    resourceType: typeof resourceType === "string" ? resourceType : null,
  };
}

async function processWebhookResource(
  resourceId: string,
  preferredMode: MollieMode | null,
) {
  if (resourceId.startsWith("tr_")) {
    return syncPaymentByMollieId(resourceId, {
      actor: {
        kind: "system",
      },
      preferredMode: preferredMode ?? undefined,
      requireManagedResource: true,
      strictMode: Boolean(preferredMode),
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
    });
  }

  throw new Error("Unsupported webhook resource id.");
}

export async function POST(request: Request) {
  const parsed = await parseWebhookRequest(request);

  if (!parsed.resourceId) {
    return new Response("Missing resource id", {
      status: 400,
    });
  }

  if (!supportedResourceIdPattern.test(parsed.resourceId)) {
    return new Response("Unsupported resource id", {
      status: 400,
    });
  }

  const webhookEventId = crypto.randomUUID();
  const existingModeResult =
    (
      await getDb().execute<ExistingResourceMode>(sql`
          select mode
          from payments
          where mollie_payment_id = ${parsed.resourceId}
          union all
          select mode
          from subscriptions
          where mollie_subscription_id = ${parsed.resourceId}
          union all
          select mode
          from payment_links
          where mollie_payment_link_id = ${parsed.resourceId}
          limit 1
        `)
    ).rows[0]?.mode ?? null;

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
        ${webhookEventId},
        ${existingModeResult ?? "test"},
        ${parsed.resourceType ?? null},
        ${parsed.resourceId},
        ${parsed.resourceType ?? "mollie-webhook"},
        ${request.headers.get("x-request-id") ?? null},
        ${JSON.stringify(parsed.payload)}::jsonb,
        'pending'
      )
    `);

  try {
    const result = await processWebhookResource(
      parsed.resourceId,
      existingModeResult,
    );

    await getDb().execute(sql`
        update webhook_events
        set
          mode = coalesce(
            (select mode from payments where id = ${result.paymentId} limit 1),
            (select mode from subscriptions where id = ${result.subscriptionId} limit 1),
            (select mode from payment_links where id = ${result.paymentLinkId} limit 1),
            mode
          ),
          processing_status = 'processed',
          error_message = null,
          last_attempt_at = now(),
          processed_at = now()
        where id = ${webhookEventId}
      `);

    return new Response("OK", {
      status: 200,
    });
  } catch (error) {
    await getDb().execute(sql`
        update webhook_events
        set
          processing_status = 'failed',
          error_message = ${serializeError(error)},
          retry_count = retry_count + 1,
          last_attempt_at = now()
        where id = ${webhookEventId}
      `);

    return new Response("Webhook processing failed", {
      status: 500,
    });
  }
}
