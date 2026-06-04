import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildConsentLinkUrl } from "@/lib/onboarding/consent-link";

describe("consent link url helper", () => {
  it("builds an absolute hosted consent url from the token", () => {
    assert.equal(
      buildConsentLinkUrl("token12345", "http://localhost:3000"),
      "http://localhost:3000/subscribe/token12345",
    );
  });
});
