import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const querySource = readFileSync(
  resolve("lib/customer-notification-history.ts"),
  "utf8",
);
const routeSource = readFileSync(
  resolve("app/api/customers/[customerId]/activity/route.ts"),
  "utf8",
);
const uiSource = readFileSync(resolve("components/customer-flow-dialogs.tsx"), "utf8");

describe("customer notification history scope", () => {
  it("loads typed history only for the authenticated customer and selected mode", () => {
    assert.match(routeSource, /getCurrentTenantSelectionForViewer/);
    assert.match(routeSource, /getCustomerDetail\(customerId, selectedMode, tenantId\)/);
    assert.match(routeSource, /listCustomerNotificationHistory/);
    assert.match(querySource, /where cpn\.mode = \$\{options\.mode\}/);
    assert.match(querySource, /coalesce\(cpn\.customer_id, p\.customer_id\) = \$\{options\.customerId\}/);
    assert.doesNotMatch(querySource, /getSingleTenantIdOrThrow/);
    assert.match(querySource, /tenantId: string;/);
  });

  it("excludes recipient, error, lease, payload, and metadata fields", () => {
    assert.doesNotMatch(querySource, /recipient_email as|subject as|last_error_message as/);
    assert.doesNotMatch(querySource, /claim_token as|payload as|metadata as/);
    assert.match(querySource, /attempt_count as "attemptCount"/);
    assert.match(querySource, /outcome_reason as "outcomeReason"/);
  });

  it("shows notification evidence in the customer drawer without delivery controls", () => {
    assert.match(uiSource, /Customer notification history/);
    assert.match(uiSource, /notification\.attemptCount/);
    assert.match(uiSource, /notification\.templateVersion/);
    assert.doesNotMatch(uiSource, /retryFailedPaymentNotification/);
  });
});
