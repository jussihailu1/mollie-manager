import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const dialogsSource = readFileSync("components/customer-flow-dialogs.tsx", "utf8");
const workspaceSource = readFileSync("components/customers-workspace.tsx", "utf8");

const dialogStart = dialogsSource.indexOf("export function RecordCancellationRequestDialog");
const drawerStart = dialogsSource.indexOf("export function CustomerDrawer");
const dialogSource = dialogsSource.slice(dialogStart, drawerStart);

describe("subscription cancellation request UI scope", () => {
  it("records review intent through the expected server action and constrained form", () => {
    assert.ok(dialogStart >= 0);
    assert.match(dialogsSource, /recordCancellationRequestAction/);
    assert.match(dialogSource, /name="subscriptionId"/);
    assert.equal(dialogSource.match(/type="hidden"/g)?.length, 1);
    assert.match(dialogSource, /name="operatorReason"[\s\S]*maxLength=\{1000\}/);
    assert.match(dialogSource, /name="requestedEffectiveDate"[\s\S]*type="date"[\s\S]*min=\{today\}/);
    assert.match(dialogSource, /cancellationEffect === "end_of_paid_period"/);
    assert.match(dialogSource, /name="paidPeriodEndDate"/);
    assert.match(dialogSource, /Current cancellation effect/);
    assert.match(dialogSource, /readOnly/);
    assert.doesNotMatch(dialogSource, /name="cancellationEffect"/);
  });

  it("limits the trigger to the latest active open-ended provider subscription", () => {
    assert.match(dialogsSource, /latestSubscriptionId &&/);
    assert.match(dialogsSource, /latestSubscriptionStatus === "active"/);
    assert.match(dialogsSource, /latestSubscriptionMollieStatus === "active"/);
    assert.match(dialogsSource, /latestSubscriptionTermMode === "open_ended"/);
    assert.match(dialogsSource, /!customer\.latestSubscriptionStopAfterCurrentPeriod/);
    assert.match(dialogsSource, /!isArchived && canRecordCancellationRequest\(customer\)/);
    assert.match(workspaceSource, /onOpenRecordCancellationRequest/);
    assert.match(workspaceSource, /<RecordCancellationRequestDialog/);
  });

  it("states that recording intent has no downstream effect", () => {
    assert.match(dialogSource, /Record cancellation request/);
    assert.match(
      dialogSource,
      /No Mollie\/provider, invoice, payment, service,[\s\S]*or billing change occurs yet\./,
    );
    assert.match(dialogSource, /review intent only/);
    assert.doesNotMatch(dialogSource, /fetch\(/);
  });
});
