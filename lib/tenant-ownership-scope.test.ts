import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("tenant ownership helper", () => {
  it("checks linked entities in stable order and fails closed without tenant context", () => {
    const source = readFileSync(resolve("lib/tenant-ownership.ts"), "utf8");

    assert.match(
      source,
      /from customers[\s\S]*from mandates[\s\S]*from payments[\s\S]*from payment_links[\s\S]*from subscriptions/,
    );
    assert.doesNotMatch(source, /getSingleTenantIdOrThrow/);
    assert.match(source, /throw new Error\("Unable to resolve tenant id from linked entity\."\);/);
    assert.match(source, /export async function requireCustomerTenantId/);
    assert.match(source, /export async function requireMandateTenantId/);
    assert.match(source, /export async function requirePaymentTenantId/);
    assert.match(source, /export async function requirePaymentLinkTenantId/);
    assert.match(source, /export async function requireSubscriptionTenantId/);
  });
});
