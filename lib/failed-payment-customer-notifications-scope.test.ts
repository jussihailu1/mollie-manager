import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync("lib/failed-payment-customer-notifications.ts", "utf8");

describe("failed payment customer notification tenant scope", () => {
  it("reads customer and recurring billing context through the payment tenant", () => {
    assert.match(source, /p\.tenant_id as "tenantId"/);
    assert.match(
      source,
      /left join customers c on c\.id = p\.customer_id and c\.tenant_id = p\.tenant_id/,
    );
    assert.match(
      source,
      /left join recurring_billing_schedules rbs on rbs\.payment_id = p\.id and rbs\.tenant_id = p\.tenant_id/,
    );
  });
});
