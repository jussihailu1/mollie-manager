import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("onboarding tenant scope", () => {
  it("threads active tenant through onboarding actions", () => {
    const source = readFileSync("lib/onboarding/actions.ts", "utf8");

    assert.match(source, /getCurrentTenantSelectionForViewer/);
    assert.match(source, /await requireViewerSession\(\);\s*const tenantSelection = await getCurrentTenantSelectionForViewer\(\);/);
    assert.match(source, /tenantId: tenantSelection\.currentTenant\.id/);
  });

  it("threads explicit tenant ids through onboarding helpers", () => {
    const actionHelpers = readFileSync("lib/onboarding/action-helpers.ts", "utf8");
    const archiveFlow = readFileSync("lib/onboarding/customer-archive-flow.ts", "utf8");
    const billingRepair = readFileSync("lib/onboarding/customer-billing-repair.ts", "utf8");
    const creationFlow = readFileSync("lib/onboarding/customer-creation-flow.ts", "utf8");
    const relationLinkFlow = readFileSync("lib/onboarding/customer-relation-link-flow.ts", "utf8");
    const firstPaymentAction = readFileSync("lib/onboarding/first-payment-action-flow.ts", "utf8");
    const firstPaymentOnboarding = readFileSync("lib/onboarding/first-payment-onboarding-flow.ts", "utf8");

    assert.match(actionHelpers, /getLocalCustomer\(\s*customerId: string,\s*mode: "live" \| "test",\s*tenantId\?: string/);
    assert.match(actionHelpers, /assertRelationIsAvailable\(\s*relationId: number,\s*mode: "live" \| "test",\s*excludeCustomerId\?: string,\s*tenantId\?: string/);
    assert.match(archiveFlow, /getCustomerDetail\(input\.customerId, input\.mode, input\.tenantId\)/);
    assert.match(billingRepair, /getCustomerDetail\(\s*input\.customerId,\s*input\.mode,\s*input\.tenantId,\s*\)/);
    assert.match(billingRepair, /tenantId: string;/);
    assert.match(
      billingRepair,
      /const mollie = await getTenantMollieClient\(tenantId, input\.mode\);/,
    );
    assert.match(
      billingRepair,
      /syncPaymentLinkByMollieId\(paymentLink\.molliePaymentLinkId, \{[\s\S]*tenantId,\s*\}\);/,
    );
    assert.match(billingRepair, /preferredMode: input\.mode/);
    assert.match(billingRepair, /strictMode: true/);
    assert.doesNotMatch(
      billingRepair,
      /syncPaymentLinkByMollieId\(paymentLink\.molliePaymentLinkId, \{[\s\S]*strictMode: true,\s*\}\);/,
    );
    assert.match(creationFlow, /const tenantId = input\.tenantId;/);
    assert.doesNotMatch(creationFlow, /getSingleTenantIdOrThrow/);
    assert.match(creationFlow, /await assertRelationIsAvailable\(relationIdToLink, input\.mode, undefined, tenantId\);/);
    assert.match(
      creationFlow,
      /const mollie = await getTenantMollieClient\(tenantId, input\.mode\);/,
    );
    assert.match(relationLinkFlow, /const customer = await getLocalCustomer\(input\.customerId, input\.mode, input\.tenantId\);/);
    assert.match(relationLinkFlow, /input\.tenantId \?\? \(await requireCustomerTenantId\(customer\.id\)\)/);
    assert.match(firstPaymentAction, /getLocalCustomer\(input\.customerId, input\.mode, input\.tenantId\)/);
    assert.match(firstPaymentAction, /getCustomerDetail\(customer\.id, input\.mode, input\.tenantId\)/);
    assert.match(firstPaymentAction, /tenantId: input\.tenantId/);
    assert.match(firstPaymentOnboarding, /ensureTenantSubscriptionPolicyDefaults\(input\.tenantId\)/);
    assert.match(
      firstPaymentOnboarding,
      /const mollie = await getTenantMollieClient\(\s*input\.tenantId,\s*input\.selectedMode,\s*\);/,
    );
  });
});
