import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildConsentLinkCreatedNotice,
  buildConsentLinkReturnTo,
} from "@/lib/onboarding/consent-link";

describe("consent link helpers", () => {
  it("keeps the creation notice generic", () => {
    const notice = buildConsentLinkCreatedNotice();

    assert.equal(
      notice,
      "First payment consent link created. Open the customer drawer to copy the hosted link.",
    );
    assert.equal(notice.includes("http"), false);
    assert.equal(notice.includes("consentToken"), false);
  });

  it("preserves the current query while focusing the customer", () => {
    assert.equal(
      buildConsentLinkReturnTo({
        customerId: "customer-123",
        pathname: "/customers",
        search: "view=setup",
      }),
      "/customers?view=setup&focus=customer-123",
    );
  });
});
