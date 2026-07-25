import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildDrawerCollectionPath,
  buildDrawerPath,
  getDrawerIdFromPath,
} from "@/lib/dashboard-drawer-route";

describe("dashboard drawer routes", () => {
  it("builds canonical customer and payment paths", () => {
    assert.equal(buildDrawerPath("customers", "customer/123"), "/customers/customer%2F123");
    assert.equal(buildDrawerPath("payments", "payment-123"), "/payments/payment-123");
  });

  it("preserves non-drawer query parameters and removes focus", () => {
    assert.equal(
      buildDrawerPath("payments", "payment-123", "customerId=customer-123&focus=old"),
      "/payments/payment-123?customerId=customer-123",
    );
    assert.equal(
      buildDrawerCollectionPath("customers", "/customers/customer-123?view=setup&focus=old"),
      "/customers?view=setup",
    );
  });

  it("reads only a single canonical drawer id from a pathname", () => {
    assert.equal(getDrawerIdFromPath("customers", "/customers/customer%2F123"), "customer/123");
    assert.equal(getDrawerIdFromPath("payments", "/payments/payment-123"), "payment-123");
    assert.equal(getDrawerIdFromPath("customers", "/customers"), null);
    assert.equal(getDrawerIdFromPath("payments", "/payments/payment-123/extra"), null);
  });
});
