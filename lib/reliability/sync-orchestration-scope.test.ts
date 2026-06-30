import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const syncSource = readFileSync("lib/reliability/sync.ts", "utf8");
const subscriptionSyncSource = readFileSync(
  "lib/reliability/subscription-sync-operations.ts",
  "utf8",
);

describe("sync orchestration tenant scope", () => {
  it("threads the resolved tenant through payment and subscription sync follow-up paths", () => {
    assert.match(syncSource, /Payment tenant context is missing\./);
    assert.match(syncSource, /Payment-link tenant context is missing\./);
    assert.match(syncSource, /findLocalMandateId\([\s\S]*resolvedTenantId/);
    assert.match(
      syncSource,
      /syncPaymentByMollieId\(payment\.id, \{[\s\S]*tenantId: resolvedTenantId,/,
    );
    assert.match(
      syncSource,
      /syncMatchingPaymentLinkForPayment\([\s\S]*resolvedTenantId/,
    );

    assert.match(subscriptionSyncSource, /const tenantId = localSubscription\.tenantId;/);
    assert.match(
      subscriptionSyncSource,
      /handlePaymentAlerts\(\{[\s\S]*tenantId,\r?\n\s*\}\);/,
    );
    assert.match(
      subscriptionSyncSource,
      /runFirstPaymentInvoiceSyncFollowUp\(\{[\s\S]*tenantId,\r?\n\s*\}\);/,
    );
    assert.match(
      subscriptionSyncSource,
      /handleSubscriptionAlerts\(\{[\s\S]*tenantId,\r?\n\s*\}\);/,
    );
    assert.match(
      subscriptionSyncSource,
      /syncSubscriptionByLocalId\(localSubscription\.id, \{[\s\S]*tenantId: localSubscription\.tenantId,/,
    );
    assert.doesNotMatch(
      subscriptionSyncSource,
      /tenantId: options\?\.tenantId \?\? localSubscription\.tenantId/,
    );
  });
});
