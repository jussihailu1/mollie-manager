import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("customer invoice resend surface", () => {
  it("reuses invoice delivery without creating invoices", () => {
    const source = readFileSync(resolve("lib/customer-invoice-resend.ts"), "utf8");

    assert.match(source, /deliverCustomerInvoiceEmail/);
    assert.match(source, /loadCustomerInvoiceResendTarget/);
    assert.doesNotMatch(source, /getSingleTenantIdOrThrow/);
    assert.doesNotMatch(source, /createFirstPaymentInvoice|createRecurringInvoice/);
    assert.doesNotMatch(source, /invoice\.create|batch_create/);
    assert.match(source, /canonical_invoice_number/);
    assert.match(source, /i\.id as "invoiceId"/);
  });

  it("serves manual resend through an authenticated customer api", () => {
    const source = readFileSync(
      resolve("app/api/customers/[customerId]/invoices/resend/route.ts"),
      "utf8",
    );

    assert.match(source, /getCurrentTenantSelectionForViewer/);
    assert.match(source, /getCustomerDetail\(customerId, selectedMode, tenantId\)/);
    assert.match(source, /resendCustomerInvoiceEmail/);
    assert.match(source, /ownerType/);
    assert.match(source, /ownerId/);
  });

  it("adds a confirmed resend button to customer invoice rows", () => {
    const source = readFileSync(resolve("components/customer-flow-dialogs.tsx"), "utf8");

    assert.match(source, /handleResendInvoice/);
    assert.match(source, /window\.confirm/);
    assert.match(source, /will not create a new invoice/);
    assert.match(source, /\/invoices\/resend/);
    assert.match(source, /Resend/);
  });
});
