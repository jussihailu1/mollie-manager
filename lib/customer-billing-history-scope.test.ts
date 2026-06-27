import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("customer billing history surface", () => {
  it("serves customer billing history through an authenticated customer api", () => {
    const source = readFileSync(
      resolve("app/api/customers/[customerId]/billing-history/route.ts"),
      "utf8",
    );

    assert.match(source, /getCurrentTenantSelectionForViewer/);
    assert.match(source, /getCustomerDetail\(customerId, selectedMode, tenantId\)/);
    assert.match(source, /payments: detail\.payments/);
    assert.match(source, /mandates: detail\.mandates/);
    assert.match(source, /subscriptions: detail\.subscriptions/);
  });

  it("loads dense billing history inside the customer drawer", () => {
    const source = readFileSync(resolve("components/customer-flow-dialogs.tsx"), "utf8");

    assert.match(source, /billing-history/);
    assert.match(source, /Billing history/);
    assert.match(source, /Subscriptions/);
    assert.match(source, /Mandates/);
    assert.match(source, /Payments/);
  });
});
