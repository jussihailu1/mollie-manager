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
        eboekhoudenInvoiceId: "inv_123",
        eboekhoudenInvoiceNumber: "2026-001",
        eboekhoudenInvoicePdfUrl: "https://example.com/invoice.pdf",
        entityId: "pay_123",
        mode: "live",
        subscriptionId: "sub_123",
        tenantId: "tenant_123",
      }),
      {
        actor: { email: "ops@example.com", kind: "user" },
        customerEmail: "customer@example.com",
        customerId: "cust_123",
        eboekhoudenInvoiceId: "inv_123",
        eboekhoudenInvoiceNumber: "2026-001",
        eboekhoudenInvoicePdfUrl: "https://example.com/invoice.pdf",
        entityId: "pay_123",
        invoiceType: "first_payment",
        mode: "live",
        subscriptionId: "sub_123",
        tenantId: "tenant_123",
      },
    );
  });
});
