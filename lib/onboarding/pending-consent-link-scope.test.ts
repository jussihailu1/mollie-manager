import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("pending consent link controls", () => {
  it("keeps pending-link removal tenant-, mode-, and acceptance-scoped", () => {
    const source = readFileSync(resolve("lib/onboarding/pending-consent-link.ts"), "utf8");

    assert.match(source, /soc\.tenant_id = \$\{tenantId\}/);
    assert.match(source, /soc\.mode = \$\{mode\}/);
    assert.match(source, /soc\.accepted_at is null/);
    assert.match(source, /c\.archived_at is null/);
    assert.match(source, /mollie\.paymentLinks\.delete/);
    assert.match(source, /statusCode === 404/);
    assert.match(source, /delete from payment_links/);
  });

  it("keeps edit and delete controls unavailable once consent is accepted", () => {
    const source = readFileSync(resolve("components/customer-flow-dialogs.tsx"), "utf8");

    assert.match(source, /canEditConsentLink = consentCreated && !customer\.latestConsentAcceptedAt/);
    assert.match(source, /Replace this consent link\?/);
    assert.match(source, /Delete this consent link\?/);
    assert.match(source, /cannot be recovered/);
  });

});
