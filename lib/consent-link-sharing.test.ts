import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildConsentPreviewMetadata, buildConsentShareMessage, buildConsentShareReturnPath } from "./consent-link-sharing";

const details = {
  issuerName: "Ayal Web",
  firstPaymentMode: "real_installment" as const,
  firstPaymentAmountValue: "49.99",
};
const url = "https://example.test/subscribe/fixture-token";

describe("consent link sharing", () => {
  it("addresses the recipient while identifying the issuer and the actual first payment", () => {
    const message = buildConsentShareMessage({ ...details, recipientName: "Nike", url });
    assert.match(message, /^Hi Nike,/);
    assert.match(message, /your subscription with Ayal Web/);
    assert.match(message, /first payment of €\s49,99/);
    assert.ok(message.endsWith(`\n\n${url}`));
  });

  it("describes the mandate-only payment as setup, not a subscription installment", () => {
    const message = buildConsentShareMessage({ ...details, firstPaymentMode: "mandate_only", firstPaymentAmountValue: "0.01", recipientName: "Nike", url });
    assert.match(message, /€\s0,01 setup payment/);
    assert.match(message, /authorize future subscription payments/);
    assert.doesNotMatch(message, /first payment|49,99/);
  });

  it("has readable fallbacks when names are missing", () => {
    const message = buildConsentShareMessage({ ...details, issuerName: " ", recipientName: " ", url });
    assert.match(message, /^Hi there,/);
    assert.match(message, /confirm your subscription, then/);
    assert.doesNotMatch(message, /null|undefined|Kify/);
  });

  it("restores sharing on both entry points without losing filters or drawer URLs", () => {
    for (const path of ["/customers/nike?view=setup", "/payments?customerId=nike"]) {
      const destination = new URL(buildConsentShareReturnPath(path, "nike"), "https://example.test");
      assert.equal(destination.searchParams.get("shareConsent"), "nike");
      assert.equal(destination.pathname, path.split("?")[0]);
      assert.equal(destination.searchParams.get(path.startsWith("/customers") ? "view" : "customerId"), path.startsWith("/customers") ? "setup" : "nike");
    }
    assert.equal(buildConsentShareReturnPath("/customers?shareConsent=old", "nike"), "/customers?shareConsent=nike");
  });

  it("never redirects sharing to another origin or unrelated route", () => {
    for (const path of ["//evil.test", "/\\evil.test", "https://evil.test", "/settings", "/customers/../../settings"]) {
      assert.equal(buildConsentShareReturnPath(path, "nike"), "/customers?shareConsent=nike");
    }
  });

  it("overrides dashboard branding with issuer metadata and an explicit preview image", () => {
    const metadata = buildConsentPreviewMetadata(details, `${url}/preview`);
    assert.deepEqual(metadata.title, { absolute: "Your subscription with Ayal Web" });
    assert.equal(metadata.openGraph?.title, "Your subscription with Ayal Web");
    assert.deepEqual(metadata.robots, { index: false, follow: false });
    assert.match(JSON.stringify(metadata.openGraph?.images), /fixture-token\/preview/);
    assert.doesNotMatch(JSON.stringify(metadata), /Kify|Internal operations|49.99|Nike/);
  });

  it("uses setup wording in previews and a neutral fallback for invalid links", () => {
    assert.match(buildConsentPreviewMetadata({ ...details, firstPaymentMode: "mandate_only" }, `${url}/preview`).description!, /setup payment/);
    const invalid = buildConsentPreviewMetadata(null, `${url}/preview`);
    assert.deepEqual(invalid.title, { absolute: "Subscription link unavailable" });
    assert.doesNotMatch(JSON.stringify(invalid), /Ayal Web|Kify/);
    assert.deepEqual(buildConsentPreviewMetadata({ ...details, issuerName: null }, `${url}/preview`).title, { absolute: "Confirm your subscription" });
  });
});
