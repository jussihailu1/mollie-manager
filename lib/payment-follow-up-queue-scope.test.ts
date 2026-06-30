import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const querySource = readFileSync(resolve("lib/payment-follow-up-queue.ts"), "utf8");
const pageSource = readFileSync(
  resolve("app/(dashboard)/notifications/page.tsx"),
  "utf8",
);
const uiSource = readFileSync(resolve("components/notifications-workspace.tsx"), "utf8");

describe("payment follow-up queue scope", () => {
  it("isolates one explicit Mollie mode and deduplicates durable alerts", () => {
    assert.match(querySource, /mode: MollieMode/);
    assert.match(querySource, /tenantId: string/);
    assert.match(querySource, /where p\.tenant_id = \$\{tenantId\}/);
    assert.match(querySource, /and c\.tenant_id = \$\{tenantId\}/);
    assert.match(querySource, /p\.tenant_id = \$\{tenantId\}[\s\S]*p\.mode = \$\{mode\}/);
    assert.match(querySource, /candidate_notification\.mode = p\.mode/);
    assert.match(querySource, /cpn\.mode = p\.mode/);
    assert.match(querySource, /row_number\(\) over/);
    assert.match(querySource, /follow_up_alert\.position = 1/);
    assert.match(querySource, /p2\.tenant_id = \$\{tenantId\}/);
    assert.match(querySource, /failed_payment_customer_notification/g);
    assert.doesNotMatch(querySource, /getSingleTenantIdOrThrow/);
  });

  it("returns status evidence without raw notification or alert content", () => {
    assert.doesNotMatch(querySource, /recipient_email as|subject as|last_error_message as/);
    assert.doesNotMatch(querySource, /payload as|metadata as|claim_token as/);
    assert.match(querySource, /attempt_count as "attemptCount"/);
    assert.match(querySource, /sent_at as "sentAt"/);
    assert.match(querySource, /failed_at as "failedAt"/);
  });

  it("renders a read-only filtered queue in the notifications workspace", () => {
    assert.match(pageSource, /listPaymentFollowUpQueue/);
    assert.match(pageSource, /paymentFollowUps=\{followUpResult\}/);
    assert.match(uiSource, /Payment follow-up queue/);
    assert.match(uiSource, /Needs follow-up/);
    assert.match(uiSource, /Customer notified/);
    assert.doesNotMatch(uiSource, /retryPayment|cancelSubscription|pauseSubscription/);
  });
});
