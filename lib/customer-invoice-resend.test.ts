import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resendCustomerInvoiceEmailWithDependencies } from "@/lib/customer-invoice-resend-flow";

describe("customer invoice resend flow", () => {
  it("delivers one existing invoice target without creating invoices", async () => {
    const calls: string[] = [];
    const result = await resendCustomerInvoiceEmailWithDependencies(
      {
        actor: { email: "operator@example.com", kind: "user" },
        customerId: "cus_1",
        mode: "test",
        ownerId: "payment_1",
        ownerType: "payment",
        tenantId: "tenant_1",
      },
      {
        async loadTarget(input) {
          calls.push(`load:${input.ownerType}:${input.ownerId}`);
          return {
            customerEmail: "customer@example.com",
            customerId: input.customerId,
            entityId: input.ownerId,
            invoiceDocumentUrl: null,
            invoiceId: "123",
            invoiceNumber: "INV-123",
            invoiceProvider: "eboekhouden",
            invoiceType: "first_payment",
            mode: "test",
            plannedCollectionDate: null,
            subscriptionId: null,
            tenantId: input.tenantId,
          };
        },
        async deliverCustomerInvoiceEmail(input) {
          calls.push(`deliver:${input.entityId}:${input.invoiceNumber}`);
          return { status: "sent" };
        },
      },
    );

    assert.equal(result.status, "sent");
    assert.deepEqual(calls, ["load:payment:payment_1", "deliver:payment_1:INV-123"]);
  });

  it("does not deliver when the invoice target is missing", async () => {
    let delivered = false;
    const result = await resendCustomerInvoiceEmailWithDependencies(
      {
        actor: { email: "operator@example.com", kind: "user" },
        customerId: "cus_1",
        mode: "test",
        ownerId: "missing",
        ownerType: "recurring_schedule",
        tenantId: "tenant_1",
      },
      {
        async loadTarget() {
          return null;
        },
        async deliverCustomerInvoiceEmail() {
          delivered = true;
          return { status: "sent" };
        },
      },
    );

    assert.equal(result.status, "not_found");
    assert.equal(delivered, false);
  });
});
