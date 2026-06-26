import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const actionSource = readFileSync(resolve("lib/operations/actions.ts"), "utf8");
const requestSource = readFileSync(
  resolve("lib/subscription-operation-requests.ts"),
  "utf8",
);
const resourceStateSource = readFileSync(
  resolve("lib/reliability/sync-resource-state.ts"),
  "utf8",
);
const cancellationSchemaSource = actionSource.slice(
  actionSource.indexOf("const cancellationRequestSchema"),
  actionSource.indexOf("const withdrawOperationRequestSchema"),
);
const withdrawSchemaSource = actionSource.slice(
  actionSource.indexOf("const withdrawOperationRequestSchema"),
  actionSource.indexOf("async function recordCancellationRequest"),
);
const auditTypeSource = requestSource.slice(
  requestSource.indexOf("type CancellationRequestAudit"),
  requestSource.indexOf("export type CancellationRequestTransaction"),
);

describe("cancellation request source boundaries", () => {
  it("accepts only the four cancellation request client fields", () => {
    assert.match(cancellationSchemaSource, /subscriptionId: z\.string\(\)\.uuid\(\)/);
    assert.match(cancellationSchemaSource, /operatorReason: z\.string\(\)\.trim\(\)\.min\(1\)\.max\(1000\)/);
    assert.match(cancellationSchemaSource, /requestedEffectiveDate: strictCalendarDateSchema/);
    assert.match(cancellationSchemaSource, /paidPeriodEndDate:/);
    assert.match(cancellationSchemaSource, /\.strict\(\)/);
    assert.doesNotMatch(
      cancellationSchemaSource,
      /\b(mode|operation|status|cancellationEffect|providerMutationRequirement|returnTo)\s*:/,
    );
  });

  it("authenticates, selects server-side mode, and uses a fixed customer redirect", () => {
    assert.match(actionSource, /export async function recordCancellationRequestAction/);
    assert.match(actionSource, /await requireViewerSession\(\)/);
    assert.match(actionSource, /await getSelectedMollieMode\(\)/);
    assert.match(
      actionSource,
      /redirectWithMessage\(`\/customers\?focus=\$\{encodeURIComponent\(result\.customerId\)\}`/,
    );
  });

  it("locks and loads cancellation policy state in the selected mode", () => {
    assert.match(resourceStateSource, /export async function lockCancellationRequestSubscription/);
    assert.match(resourceStateSource, /local_status as "localStatus"/);
    assert.match(resourceStateSource, /mollie_status as "mollieStatus"/);
    assert.match(resourceStateSource, /subscription_term_mode as "termMode"/);
    assert.match(resourceStateSource, /cancellation_effect as "cancellationEffect"/);
    assert.match(resourceStateSource, /service_end_at as "serviceEndAt"/);
    assert.match(resourceStateSource, /customer_id as "customerId"/);
    assert.match(resourceStateSource, /and mode = \$\{mode\}[\s\S]*for update/);
  });

  it("records only pending intent and never applies or schedules it", () => {
    assert.match(actionSource, /insert into subscription_operation_requests/);
    assert.match(actionSource, /'cancel',[\s\S]*'pending'/);
    assert.match(actionSource, /on conflict \(subscription_id, operation\)[\s\S]*do nothing/);
    assert.match(actionSource, /no provider change occurred/);
    assert.match(actionSource, /entityType: "subscription"/);
    assert.match(actionSource, /entityId: audit\.subscriptionId/);
    assert.match(requestSource, /providerMutationRequirement: decision\.providerMutationRequirement/);
    assert.doesNotMatch(auditTypeSource, /operatorReason|requestedByEmail/);
    assert.doesNotMatch(requestSource, /@mollie\/api-client|getMollieClient|customerSubscriptions/);
    assert.doesNotMatch(
      requestSource,
      /update\s+(subscriptions|invoices|payments)|insert into recurring_billing_schedules/i,
    );
  });

  it("withdraws only unresolved request state and keeps provider changes unavailable", () => {
    assert.match(withdrawSchemaSource, /operationRequestId: z\.string\(\)\.uuid\(\)/);
    assert.match(withdrawSchemaSource, /returnTo: z\.string\(\)\.trim\(\)\.startsWith\("\/"\)/);
    assert.match(actionSource, /export async function withdrawOperationRequestAction/);
    assert.match(resourceStateSource, /export async function lockManagedOperationRequest/);
    assert.match(resourceStateSource, /from subscription_operation_requests sor/);
    assert.match(actionSource, /update subscription_operation_requests/);
    assert.match(actionSource, /status = 'withdrawn'/);
    assert.match(actionSource, /withdrawn_at = now\(\)/);
    assert.match(actionSource, /status in \('pending', 'scheduled', 'processing'\)/);
    assert.match(actionSource, /subscription\.operation_request\.withdraw/);
    assert.match(actionSource, /no provider change occurred/);
    assert.doesNotMatch(actionSource, /@mollie\/api-client|getMollieClient|customerSubscriptions/);
    assert.doesNotMatch(
      actionSource,
      /update\s+(subscriptions|invoices|payments)|insert into recurring_billing_schedules/i,
    );
  });

  it("transitions only unresolved request state and keeps provider changes unavailable", () => {
    assert.match(actionSource, /const transitionOperationRequestSchema/);
    assert.match(actionSource, /targetStatus: z\.enum\(\["processing", "scheduled"\]\)/);
    assert.match(actionSource, /export async function transitionOperationRequestAction/);
    assert.match(actionSource, /transitionSubscriptionOperationRequestWithDependencies/);
    assert.match(actionSource, /update subscription_operation_requests/);
    assert.match(actionSource, /processing_at = case/);
    assert.match(actionSource, /when \$\{nextStatus\} = 'processing'/);
    assert.match(actionSource, /status = \$\{previousStatus\}/);
    assert.match(actionSource, /subscription\.operation_request\.transition/);
    assert.match(actionSource, /no provider change occurred/);
    assert.doesNotMatch(actionSource, /@mollie\/api-client|getMollieClient|customerSubscriptions/);
    assert.doesNotMatch(
      actionSource,
      /update\s+(subscriptions|invoices|payments)|insert into recurring_billing_schedules/i,
    );
  });
});
