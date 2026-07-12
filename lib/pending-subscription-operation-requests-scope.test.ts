import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const source = readFileSync(
  resolve("lib/pending-subscription-operation-requests.ts"),
  "utf8",
);

describe("pending subscription operation request query scope", () => {
  it("loads unresolved requests through a sanitized customer/subscription projection", () => {
    assert.match(source, /from subscription_operation_requests sor/);
    assert.match(source, /inner join subscriptions s/);
    assert.match(source, /inner join customers c/);
    assert.match(source, /tenantId: string/);
    assert.match(source, /sor\.status in \('pending', 'scheduled', 'processing'\)/);
    assert.match(source, /sor\.tenant_id = \$\{tenantId\}/);
    assert.match(source, /requested_effective_at as "requestedEffectiveAt"/);
    assert.match(source, /paid_period_end_at as "paidPeriodEndAt"/);
    assert.match(source, /cancellation_effect as "cancellationEffect"/);
    assert.match(source, /recommendedAction/);
    assert.doesNotMatch(source, /getSingleTenantIdOrThrow/);
  });

  it("keeps operator reason and requester email out of the surfaced payload", () => {
    assert.doesNotMatch(source, /operator_reason/);
    assert.doesNotMatch(source, /requested_by_email/);
    assert.doesNotMatch(source, /payload|token|secret/i);
  });
});
