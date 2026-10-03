import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { discoverWebhookPaymentContext, type WebhookPaymentIdentity } from "./webhook-context-discovery";
import { handleMollieWebhookRequest, type WebhookEventInsertInput } from "./webhook-processing";
import { collectSubscriptionPayments } from "./subscription-payment-discovery";

const live = { tenantId: "owner", mode: "live" as const };
const other = { tenantId: "other", mode: "live" as const };
const test = { tenantId: "owner", mode: "test" as const };
const payment: WebhookPaymentIdentity = { id: "tr_september", mode: "live", customerId: "cst_gb", subscriptionId: "sub_gb" };

describe("new recurring payment webhook ownership", () => {
  it("imports an unseen live payment through verified provider ownership and retries idempotently", async () => {
    const events: WebhookEventInsertInput[] = [];
    const stored = new Set<string>();
    const resolver = () => discoverWebhookPaymentContext(payment.id, {
      candidates: [other, test, live],
      fetchPayment: async (context) => context === other ? null : payment,
      isManagedPayment: async (p, context) => context === live && p.customerId === "cst_gb" && p.subscriptionId === "sub_gb",
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await handleMollieWebhookRequest(new Request("https://example.test/webhook", {
        method: "POST", body: new URLSearchParams({ id: payment.id }),
      }), {
        findExistingResourceContext: resolver,
        insertWebhookEvent: async (event) => { events.push(event); },
        syncResource: async (id, mode, tenant) => {
          assert.equal(mode, "live"); assert.equal(tenant, "owner"); stored.add(id);
          return { paymentId: "local_september" };
        },
        markWebhookEventProcessed: async () => {},
        markWebhookEventFailed: async () => { assert.fail("verified payment must process"); },
      });
      assert.equal(result.status, 200);
    }
    assert.equal(stored.size, 1);
    assert.ok(events.every((event) => event.mode === "live" && event.tenantId === "owner"));
  });

  it("rejects mode mismatch, unrelated customers/subscriptions, and mismatched resource IDs", async () => {
    for (const remote of [payment, { ...payment, id: "tr_different" }, { ...payment, customerId: undefined }]) {
      assert.equal(await discoverWebhookPaymentContext(payment.id, {
        candidates: [test], fetchPayment: async () => remote,
        isManagedPayment: async () => { assert.fail("invalid identity must not reach ownership lookup"); },
      }), null);
    }
    assert.equal(await discoverWebhookPaymentContext(payment.id, {
      candidates: [live], fetchPayment: async () => payment, isManagedPayment: async () => false,
    }), null);
  });

  it("fails closed and stores unresolved mode for ambiguous owners", async () => {
    const resolver = () => discoverWebhookPaymentContext(payment.id, {
      candidates: [live, other], fetchPayment: async () => payment, isManagedPayment: async () => true,
    });
    await assert.rejects(resolver, /ambiguous/);
    let inserted: WebhookEventInsertInput | undefined;
    const result = await handleMollieWebhookRequest(new Request("https://example.test/webhook", {
      method: "POST", body: new URLSearchParams({ id: payment.id }),
    }), {
      findExistingResourceContext: resolver,
      insertWebhookEvent: async (event) => { inserted = event; },
      syncResource: async () => { throw new Error("must not sync"); },
      markWebhookEventProcessed: async () => { assert.fail("must not process"); },
      markWebhookEventFailed: async (event) => { assert.match(event.errorMessage, /ambiguous/); },
    });
    assert.equal(result.status, 500);
    assert.equal(inserted?.mode, null);
    assert.equal(inserted?.tenantId, null);
  });
});

describe("subscription discovery pagination", () => {
  it("discovers a payment after the first page and never returns a partial provider response", async () => {
    async function* pages() {
      for (let index = 0; index < 250; index++) yield { id: `tr_old${index}` };
      yield { id: payment.id };
    }
    const collected = await collectSubscriptionPayments(pages());
    assert.equal(collected.length, 251);
    assert.equal(collected[250]?.id, payment.id);
    async function* broken() { yield payment; throw new Error("provider unavailable"); }
    await assert.rejects(collectSubscriptionPayments(broken()), /provider unavailable/);
    await assert.rejects(collectSubscriptionPayments(pages(), (p) => p.id !== payment.id), /ownership or mode/);
  });
});
