import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const billingSettingsSource = readFileSync("lib/billing-settings.ts", "utf8");
const subscriptionPolicyDefaultsSource = readFileSync(
  "lib/subscription-policy-defaults.ts",
  "utf8",
);

describe("tenant settings helper scope", () => {
  it("requires explicit tenant ids for billing settings and subscription policy defaults", () => {
    assert.match(
      billingSettingsSource,
      /export async function ensureTenantBillingSettings\(tenantId: string\)/,
    );
    assert.match(
      billingSettingsSource,
      /export async function getTenantBillingSettings\(tenantId: string\)/,
    );
    assert.match(
      billingSettingsSource,
      /export async function updateTenantBillingSettings\(/,
    );
    assert.doesNotMatch(billingSettingsSource, /getSingleTenantIdOrThrow/);

    assert.match(
      subscriptionPolicyDefaultsSource,
      /export async function ensureTenantSubscriptionPolicyDefaults\(tenantId: string\)/,
    );
    assert.match(
      subscriptionPolicyDefaultsSource,
      /export async function getTenantSubscriptionPolicyDefaults\(tenantId: string\)/,
    );
    assert.doesNotMatch(
      subscriptionPolicyDefaultsSource,
      /getSingleTenantIdOrThrow/,
    );
  });
});
