import assert from "node:assert/strict";
import { it } from "node:test";
import { getRouteRefreshIntervalMs } from "./freshness";

it("refreshes open customer/payment details as well as list pages", () => {
  for (const route of ["/customers/customer-1", "/payments/payment-1", "/"]) assert.equal(getRouteRefreshIntervalMs(route), 30_000);
  for (const route of ["/customers", "/payments", "/payment-links"]) assert.equal(getRouteRefreshIntervalMs(route), 90_000);
  assert.equal(getRouteRefreshIntervalMs("/login"), null);
});
