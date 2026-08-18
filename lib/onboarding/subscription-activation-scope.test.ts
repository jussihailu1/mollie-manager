import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync("lib/onboarding/subscription-activation.ts", "utf8");
const notificationsSource = readFileSync(
  "lib/onboarding/subscription-activation-notifications.ts",
  "utf8",
);

describe("subscription activation tenant scope", () => {
  it("requires explicit tenant context for activation reads", () => {
    assert.match(
      source,
      /async function getActivationContext\(\s*customerId: string,\s*mode: MollieMode,\s*tenantId: string,\s*\)/,
    );
    assert.match(source, /and tenant_id = \$\{tenantId\}/);
    assert.match(
      source,
      /export async function attemptSubscriptionActivation\(input: \{[\s\S]*tenantId: string;[\s\S]*trigger: ActivationTrigger;/,
    );
    assert.doesNotMatch(source, /requireCustomerTenantId/);
  });

  it("claims activation notifications without referencing the update target in FROM joins", () => {
    assert.match(
      notificationsSource,
      /select id, subscription_id, customer_id from subscription_activation_notifications/,
    );
    assert.match(
      notificationsSource,
      /left join subscriptions s on s\.id = c\.subscription_id/,
    );
    assert.doesNotMatch(notificationsSource, /s\.id = n\.subscription_id/);
  });
});
