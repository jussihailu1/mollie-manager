import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const source = readFileSync(
  resolve("lib/failed-payment-customer-notifications.ts"),
  "utf8",
);

describe("failed payment notification claim persistence", () => {
  it("reclaims eligible rows atomically without reclaiming terminal delivery", () => {
    assert.match(source, /on conflict \(mode, payment_id, notification_type\) do update/);
    assert.match(source, /status = 'failed'/);
    assert.match(source, /status = 'claimed'/);
    assert.match(source, /attempt_count < \$\{MAX_FAILED_PAYMENT_NOTIFICATION_ATTEMPTS\}/);
    assert.match(source, /returning id, claim_token as "claimToken"/);
  });

  it("lets only the current claim lease finalize an attempt", () => {
    assert.match(source, /claim_token = excluded\.claim_token/);
    assert.match(source, /and claim_token = \$\{claim\.claimToken\}/g);
    assert.match(source, /where id = \$\{claim\.id\}\s+and status = 'claimed'/g);
  });
});
