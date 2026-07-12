import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync("lib/onboarding/subscription-activation.ts", "utf8");

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
});
