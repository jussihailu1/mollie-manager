import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("customer invoice links surface", () => {
  it("returns Kify document routes and sanitized legacy invoice urls", () => {
    const source = readFileSync(resolve("lib/customer-invoice-links.ts"), "utf8");

    assert.match(source, /normalizeTrustedInvoicePdfUrl/);
    assert.match(source, /candidateInvoicePdfUrl/);
    assert.match(source, /normalizeTrustedInvoicePdfUrl\(row\.candidateInvoicePdfUrl\)/);
    assert.match(source, /invoiceProvider === "kify"/);
    assert.match(source, /\/api\/invoices\/\$\{encodeURIComponent\(row\.invoiceRecordId\)\}\/document/);
    assert.match(source, /canonical_invoice_number/);
    assert.match(source, /from payments p/);
    assert.match(source, /from recurring_billing_schedules rbs/);
    assert.doesNotMatch(source, /getSingleTenantIdOrThrow/);
    assert.match(source, /tenantId: string;/);
  });

  it("serves invoice links through an authenticated customer api", () => {
    const source = readFileSync(
      resolve("app/api/customers/[customerId]/invoices/route.ts"),
      "utf8",
    );

    assert.match(source, /getCurrentTenantSelectionForViewer/);
    assert.match(source, /getSelectedMollieMode/);
    assert.match(source, /getCustomerDetail\(customerId, selectedMode, tenantId\)/);
    assert.match(source, /listCustomerInvoiceLinks/);
    assert.match(source, /Response\.json\(\{ invoices \}\)/);
  });

  it("loads customer invoice download links inside the drawer", () => {
    const source = readFileSync(resolve("components/customer-flow-dialogs.tsx"), "utf8");

    assert.match(source, /CustomerInvoiceLinks/);
    assert.match(source, /\/api\/customers\/\$\{encodeURIComponent\(resolvedCustomerId\)\}\/invoices/);
    assert.match(source, /No trusted PDF link/);
    assert.match(source, /Download/);
  });
});
