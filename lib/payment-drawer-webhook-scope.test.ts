import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("payment drawer webhook scope", () => {
  it("keeps the raw Mollie webhook url out of the api payload", () => {
    const source = readFileSync(resolve("app/api/payments/mollie/route.ts"), "utf8");

    assert.match(source, /webhookUrlStatus: payment\.webhookUrl \? "hidden" : "missing"/);
    assert.doesNotMatch(source, /webhookUrl:\s*payment\.webhookUrl/);
  });

  it("shows only a non-secret webhook status in the drawer", () => {
    const source = readFileSync(resolve("components/payment-drawer.tsx"), "utf8");

    assert.match(source, /Webhook Callback/);
    assert.match(source, /Configured in Mollie and hidden in this UI\./);
  });
});
