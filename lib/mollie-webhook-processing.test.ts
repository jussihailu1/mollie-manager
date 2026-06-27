import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  handleMollieWebhookRequest,
  isSupportedWebhookResourceId,
  parseMollieWebhookRequest,
  serializeWebhookError,
  type MollieWebhookProcessorDependencies,
  type WebhookEventFailedInput,
  type WebhookEventInsertInput,
  type WebhookEventProcessedInput,
} from "./reliability/webhook-processing";

function jsonRequest(payload: Record<string, unknown>) {
  return new Request("https://example.test/api/webhooks/mollie", {
    body: JSON.stringify(payload),
    headers: {
      "content-type": "application/json",
      "x-request-id": "req_test",
    },
    method: "POST",
  });
}

function formRequest(payload: Record<string, string>) {
  return new Request("https://example.test/api/webhooks/mollie", {
    body: new URLSearchParams(payload),
    method: "POST",
  });
}

function createDependencies(overrides: Partial<MollieWebhookProcessorDependencies> = {}) {
  const inserted: WebhookEventInsertInput[] = [];
  const failed: WebhookEventFailedInput[] = [];
  const processed: WebhookEventProcessedInput[] = [];
  const synced: Array<{
    preferredMode: "live" | "test" | null;
    resourceId: string;
    tenantId: string | null;
  }> = [];

  const dependencies: MollieWebhookProcessorDependencies = {
    createWebhookEventId: () => "webhook_event_test",
    findExistingResourceContext: async () => ({
      mode: "live",
      tenantId: "tenant_test",
    }),
    insertWebhookEvent: async (input) => {
      inserted.push(input);
    },
    markWebhookEventFailed: async (input) => {
      failed.push(input);
    },
    markWebhookEventProcessed: async (input) => {
      processed.push(input);
    },
    syncResource: async (resourceId, preferredMode, tenantId) => {
      synced.push({
        tenantId,
        preferredMode,
        resourceId,
      });

      return {
        paymentId: "payment_test",
      };
    },
    ...overrides,
  };

  return {
    dependencies,
    failed,
    inserted,
    processed,
    synced,
  };
}

describe("mollie webhook processing", () => {
  it("parses json webhook payloads by id/resource or resourceId/resourceType", async () => {
    const parsedById = await parseMollieWebhookRequest(
      jsonRequest({
        id: "tr_json",
        resource: "payment",
      }),
    );
    const parsedByResourceId = await parseMollieWebhookRequest(
      jsonRequest({
        resourceId: "sub_json",
        resourceType: "subscription",
      }),
    );

    assert.equal(parsedById.resourceId, "tr_json");
    assert.equal(parsedById.resourceType, "payment");
    assert.equal(parsedByResourceId.resourceId, "sub_json");
    assert.equal(parsedByResourceId.resourceType, "subscription");
  });

  it("parses form webhook payloads", async () => {
    const parsed = await parseMollieWebhookRequest(
      formRequest({
        id: "pl_form",
        resource: "payment-link",
      }),
    );

    assert.equal(parsed.resourceId, "pl_form");
    assert.equal(parsed.resourceType, "payment-link");
    assert.equal(parsed.payload.id, "pl_form");
  });

  it("rejects missing or unsupported resource ids before storing events", async () => {
    const missing = createDependencies();
    const unsupported = createDependencies();

    const missingResult = await handleMollieWebhookRequest(jsonRequest({}), missing.dependencies);
    const unsupportedResult = await handleMollieWebhookRequest(
      jsonRequest({
        id: "cs_test",
      }),
      unsupported.dependencies,
    );

    assert.equal(missingResult.status, 400);
    assert.equal(missingResult.body, "Missing resource id");
    assert.equal(unsupportedResult.status, 400);
    assert.equal(unsupportedResult.body, "Unsupported resource id");
    assert.equal(missing.inserted.length, 0);
    assert.equal(unsupported.inserted.length, 0);
  });

  it("stores pending event, syncs with existing mode, and marks processed", async () => {
    const { dependencies, inserted, processed, synced } = createDependencies();

    const result = await handleMollieWebhookRequest(
      jsonRequest({
        id: "tr_success",
        resource: "payment",
      }),
      dependencies,
    );

    assert.equal(result.status, 200);
    assert.equal(result.body, "OK");
    assert.deepEqual(synced, [
      {
        preferredMode: "live",
        resourceId: "tr_success",
        tenantId: "tenant_test",
      },
    ]);
    assert.deepEqual(inserted, [
      {
        id: "webhook_event_test",
        mode: "live",
        payload: {
          id: "tr_success",
          resource: "payment",
        },
        requestId: "req_test",
        resourceId: "tr_success",
        resourceType: "payment",
        topic: "payment",
      },
    ]);
    assert.deepEqual(processed, [
      {
        id: "webhook_event_test",
        result: {
          paymentId: "payment_test",
        },
      },
    ]);
  });

  it("uses test mode for stored events when no existing managed resource is found", async () => {
    const { dependencies, inserted, synced } = createDependencies({
      findExistingResourceContext: async () => null,
    });

    await handleMollieWebhookRequest(
      jsonRequest({
        id: "tr_unknown",
        resource: "payment",
      }),
      dependencies,
    );

    assert.equal(inserted[0]?.mode, "test");
    assert.equal(synced[0]?.preferredMode, null);
    assert.equal(synced[0]?.tenantId, null);
  });

  it("marks event failed with serialized error when sync fails", async () => {
    const { dependencies, failed, processed } = createDependencies({
      syncResource: async () => {
        throw new Error("Payment webhook is not linked to a managed local resource.");
      },
    });

    const result = await handleMollieWebhookRequest(
      jsonRequest({
        id: "tr_failure",
      }),
      dependencies,
    );

    assert.equal(result.status, 500);
    assert.equal(result.body, "Webhook processing failed");
    assert.deepEqual(processed, []);
    assert.deepEqual(failed, [
      {
        errorMessage: "Payment webhook is not linked to a managed local resource.",
        id: "webhook_event_test",
      },
    ]);
  });

  it("validates only supported Mollie webhook resource id prefixes", () => {
    assert.equal(isSupportedWebhookResourceId("tr_abc123"), true);
    assert.equal(isSupportedWebhookResourceId("sub_abc123"), true);
    assert.equal(isSupportedWebhookResourceId("pl_abc123"), true);
    assert.equal(isSupportedWebhookResourceId("cs_abc123"), false);
    assert.equal(isSupportedWebhookResourceId("tr_abc-123"), false);
  });

  it("truncates error messages persisted to webhook events", () => {
    const message = "x".repeat(250);

    assert.equal(serializeWebhookError(new Error(message)).length, 180);
    assert.equal(serializeWebhookError("plain failure"), "Webhook processing failed.");
  });
});
