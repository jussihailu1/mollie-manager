import type { MollieMode } from "@/lib/env";

export type ParsedMollieWebhookRequest = {
  payload: Record<string, unknown>;
  resourceId: string | null;
  resourceType: string | null;
};

export type WebhookResourceSyncResult = {
  paymentId?: string | null;
  paymentLinkId?: string | null;
  subscriptionId?: string | null;
};

export type WebhookResourceContext = {
  mode: MollieMode;
  tenantId: string;
};

export type WebhookEventInsertInput = {
  id: string;
  mode: MollieMode;
  payload: Record<string, unknown>;
  requestId: string | null;
  resourceId: string;
  resourceType: string | null;
  tenantId: string | null;
  topic: string;
};

export type WebhookEventProcessedInput = {
  id: string;
  result: WebhookResourceSyncResult;
};

export type WebhookEventFailedInput = {
  errorMessage: string;
  id: string;
};

export type MollieWebhookProcessorDependencies = {
  createWebhookEventId?: () => string;
  findExistingResourceContext: (
    resourceId: string,
  ) => Promise<WebhookResourceContext | null>;
  insertWebhookEvent: (input: WebhookEventInsertInput) => Promise<void>;
  markWebhookEventFailed: (input: WebhookEventFailedInput) => Promise<void>;
  markWebhookEventProcessed: (input: WebhookEventProcessedInput) => Promise<void>;
  syncResource: (
    resourceId: string,
    preferredMode: MollieMode | null,
    tenantId: string | null,
  ) => Promise<WebhookResourceSyncResult>;
};

export type MollieWebhookProcessorResult = {
  body: string;
  status: number;
};

export const supportedWebhookResourceIdPattern = /^(tr|sub|pl)_[A-Za-z0-9]+$/;

export function serializeWebhookError(error: unknown) {
  if (error instanceof Error) {
    return error.message.slice(0, 180);
  }

  return "Webhook processing failed.";
}

export async function parseMollieWebhookRequest(
  request: Request,
): Promise<ParsedMollieWebhookRequest> {
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

export function isSupportedWebhookResourceId(resourceId: string) {
  return supportedWebhookResourceIdPattern.test(resourceId);
}

export async function handleMollieWebhookRequest(
  request: Request,
  dependencies: MollieWebhookProcessorDependencies,
): Promise<MollieWebhookProcessorResult> {
  const parsed = await parseMollieWebhookRequest(request);

  if (!parsed.resourceId) {
    return {
      body: "Missing resource id",
      status: 400,
    };
  }

  if (!isSupportedWebhookResourceId(parsed.resourceId)) {
    return {
      body: "Unsupported resource id",
      status: 400,
    };
  }

  const webhookEventId = dependencies.createWebhookEventId?.() ?? crypto.randomUUID();
  const existingResourceContext = await dependencies.findExistingResourceContext(parsed.resourceId);

  await dependencies.insertWebhookEvent({
    id: webhookEventId,
    mode: existingResourceContext?.mode ?? "test",
    payload: parsed.payload,
    requestId: request.headers.get("x-request-id") ?? null,
    resourceId: parsed.resourceId,
    resourceType: parsed.resourceType,
    tenantId: existingResourceContext?.tenantId ?? null,
    topic: parsed.resourceType ?? "mollie-webhook",
  });

  if (!existingResourceContext?.tenantId) {
    const errorMessage = "Webhook is not linked to a managed local resource.";

    await dependencies.markWebhookEventFailed({
      errorMessage,
      id: webhookEventId,
    });

    return {
      body: "Webhook processing failed",
      status: 500,
    };
  }

  try {
    const result = await dependencies.syncResource(
      parsed.resourceId,
      existingResourceContext.mode,
      existingResourceContext.tenantId,
    );

    await dependencies.markWebhookEventProcessed({
      id: webhookEventId,
      result,
    });

    return {
      body: "OK",
      status: 200,
    };
  } catch (error) {
    await dependencies.markWebhookEventFailed({
      errorMessage: serializeWebhookError(error),
      id: webhookEventId,
    });

    return {
      body: "Webhook processing failed",
      status: 500,
    };
  }
}
