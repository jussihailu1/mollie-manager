import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createFakeInvoiceRenderer, InvoiceRendererRegistry, type CanonicalInvoiceSnapshot } from "@/lib/invoicing/invoice-renderer";

const snapshot: CanonicalInvoiceSnapshot = {
  amountPaidCents: 121, balanceCents: 0, currency: "EUR", dueDate: "2026-07-21", invoiceDate: "2026-07-21", invoiceId: "i1", invoiceNumber: "KFY-2026-000001",
  issuer: { city: "A", countryCode: "NL", email: "a@example.nl", legalName: "A B.V.", postalCode: "1000AA", streetAddress: "A 1" },
  lines: [{ description: "Abonnement", grossCents: 121, netCents: 100, quantity: 1, vatCents: 21, vatRateBasisPoints: 2100 }], mode: "test",
  paymentContext: { kind: "paid_first_installment" }, recipient: { city: "B", countryCode: "NL", email: "b@example.nl", legalName: "B B.V.", postalCode: "1000BB", streetAddress: "B 1" }, schemaVersion: 1, subtotalCents: 100, tenantId: "t1", totalCents: 121, vatCents: 21,
};

describe("invoice renderer contract", () => {
  it("registers replaceable renderers without workflow or schema changes", async () => {
    const registry = new InvoiceRendererRegistry();
    registry.register(createFakeInvoiceRenderer("fake-one"));
    registry.register(createFakeInvoiceRenderer("fake-two"));
    assert.equal((await registry.get("fake-two").renderPdf(snapshot)).rendererId, "fake-two");
  });
});
