import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildFirstPaymentInvoiceDelivery } from "@/lib/eboekhouden/first-payment-invoice-delivery";

describe("first-payment invoice delivery", () => {
  it("builds a delivery payload from safe invoice fields", () => {
    assert.deepEqual(
      buildFirstPaymentInvoiceDelivery({
        actor: { email: "ops@example.com", kind: "user" },
        customerEmail: "customer@example.com",
        customerId: "cust_123",
        entityId: "pay_123",
        invoiceDocumentUrl: "https://example.com/invoice.pdf",
        invoiceId: "inv_123",
        invoiceNumber: "2026-001",
        mode: "live",
        subscriptionId: "sub_123",
        tenantId: "tenant_123",
      }),
      {
        actor: { email: "ops@example.com", kind: "user" },
        customerEmail: "customer@example.com",
        customerId: "cust_123",
        entityId: "pay_123",
        invoiceDocumentUrl: "https://example.com/invoice.pdf",
        invoiceId: "inv_123",
        invoiceNumber: "2026-001",
        invoiceProvider: "eboekhouden",
        invoiceType: "first_payment",
        mode: "live",
        subscriptionId: "sub_123",
        tenantId: "tenant_123",
      },
    );
  });
});
