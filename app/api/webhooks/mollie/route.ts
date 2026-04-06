import { getMollieWebhookConfig } from "@/lib/env";
import { query } from "@/lib/db";
import { syncPaymentByMollieId, syncSubscriptionByMollieId } from "@/lib/reliability/sync";

type ExistingResourceMode = {
  mode: "live" | "test";
};

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

async function processWebhookResource(resourceId: string) {
  if (resourceId.startsWith("tr_")) {
    return syncPaymentByMollieId(resourceId, {
      actor: {
        kind: "system",
      },
    });
  }

  if (resourceId.startsWith("sub_")) {
    return syncSubscriptionByMollieId(resourceId, {
      actor: {
        kind: "system",
      },
    });
  }

  throw new Error("Unsupported webhook resource id.");
}

export async function POST(request: Request) {
  const webhookConfig = getMollieWebhookConfig();
  const secret = new URL(request.url).searchParams.get("secret");

  if (secret !== webhookConfig.MOLLIE_WEBHOOK_SHARED_SECRET) {
    return new Response("Unauthorized", {
      status: 401,
    });
  }

  const parsed = await parseWebhookRequest(request);

  if (!parsed.resourceId) {
    return new Response("Missing resource id", {
      status: 400,
    });
  }

  const webhookEventId = crypto.randomUUID();
  const existingMode =
    (
      await query<ExistingResourceMode>(
        `
          select mode
          from payments
          where mollie_payment_id = $1
          union all
          select mode
          from subscriptions
          where mollie_subscription_id = $1
          limit 1
        `,
        [parsed.resourceId],
      )
    ).rows[0]?.mode ?? "test";

  await query(
    `
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
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7::jsonb,
        'pending'
      )
    `,
    [
      webhookEventId,
      existingMode,
      parsed.resourceType ?? null,
      parsed.resourceId,
      parsed.resourceType ?? "mollie-webhook",
      request.headers.get("x-request-id") ?? null,
      JSON.stringify(parsed.payload),
    ],
  );

  try {
    const result = await processWebhookResource(parsed.resourceId);

    await query(
      `
        update webhook_events
        set
          mode = coalesce(
            (select mode from payments where id = $2 limit 1),
            (select mode from subscriptions where id = $3 limit 1),
            mode
          ),
          processing_status = 'processed',
          error_message = null,
          last_attempt_at = now(),
          processed_at = now()
        where id = $1
      `,
      [webhookEventId, result.paymentId, result.subscriptionId],
    );

    return new Response("OK", {
      status: 200,
    });
  } catch (error) {
    await query(
      `
        update webhook_events
        set
          processing_status = 'failed',
          error_message = $2,
          retry_count = retry_count + 1,
          last_attempt_at = now()
        where id = $1
      `,
      [webhookEventId, serializeError(error)],
    );

    return new Response("Webhook processing failed", {
      status: 500,
    });
  }
}
