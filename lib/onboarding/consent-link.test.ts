import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildConsentLinkReturnTo,
} from "@/lib/onboarding/consent-link";

describe("consent link helpers", () => {
  it("preserves the current query on the customer drawer route", () => {
    assert.equal(
      buildConsentLinkReturnTo({
        customerId: "customer-123",
        search: "view=setup",
      }),
      "/customers/customer-123?view=setup",
    );
  });
});
