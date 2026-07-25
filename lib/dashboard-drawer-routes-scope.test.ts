import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const customerPage = readFileSync(resolve("app/(dashboard)/customers/customers-page.tsx"), "utf8");
const customerDetailPage = readFileSync(resolve("app/(dashboard)/customers/[customerId]/page.tsx"), "utf8");
const paymentPage = readFileSync(resolve("app/(dashboard)/payments/payments-page.tsx"), "utf8");
const paymentDetailPage = readFileSync(resolve("app/(dashboard)/payments/[paymentId]/page.tsx"), "utf8");
const customerWorkspace = readFileSync(resolve("components/customers-workspace.tsx"), "utf8");
const paymentWorkspace = readFileSync(resolve("components/payments-workspace.tsx"), "utf8");

describe("dashboard drawer route scope", () => {
  it("loads canonical customer and payment detail routes through their tenant-scoped page loaders", () => {
    assert.match(customerDetailPage, /CustomerPageContent customerId=\{customerId\}/);
    assert.match(paymentDetailPage, /PaymentPageContent paymentId=\{paymentId\}/);
    assert.match(customerPage, /listCustomers\(\{ mode: selectedMode, tenantId \}\)/);
    assert.match(paymentPage, /listPayments\(\{ mode: selectedMode, tenantId \}\)/);
  });

  it("rejects deprecated focus query routes and unknown drawer records", () => {
    assert.match(customerPage, /if \("focus" in resolvedSearchParams\) \{\s*notFound\(\);/);
    assert.match(paymentPage, /if \("focus" in resolvedSearchParams\) \{\s*notFound\(\);/);
    assert.match(customerPage, /if \(customerId && !\[\.\.\.customers, \.\.\.archivedCustomers\]\.some/);
    assert.match(paymentPage, /if \(paymentId && !payments\.some/);
  });

  it("keeps routeable drawers stable while opening same-customer modals", () => {
    assert.match(customerWorkspace, /setSelectedCustomerId\(customer\.id\);\s*setIsCustomerDrawerOpen\(true\);\s*window\.history\.pushState/);
    assert.match(paymentWorkspace, /setSelectedPaymentId\(payment\.id\);\s*setIsPaymentDrawerOpen\(true\);\s*window\.history\.pushState/);
    assert.match(customerWorkspace, /window\.addEventListener\("popstate", syncDrawerFromHistory\)/);
    assert.match(paymentWorkspace, /window\.addEventListener\("popstate", syncDrawerFromHistory\)/);

    const customerDrawerHandlers = customerWorkspace.slice(
      customerWorkspace.indexOf("<CustomerDrawer"),
      customerWorkspace.indexOf("<CustomerArchiveDialog"),
    );

    assert.doesNotMatch(customerDrawerHandlers, /onOpen\w+=\{\(customer\) => \{\s*setIsCustomerDrawerOpen\(false\)/);
    assert.doesNotMatch(customerDrawerHandlers, /if \(!open\) \{\s*setSelectedCustomerId\(null\)/);
    assert.doesNotMatch(paymentWorkspace, /if \(!open\) \{\s*setSelectedPaymentId\(null\)/);
  });
});
