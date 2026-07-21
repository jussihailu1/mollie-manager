import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createFakeInvoiceArtifactStore } from "@/lib/invoicing/invoice-artifact-store";
import { createFakeInvoiceRenderer } from "@/lib/invoicing/invoice-renderer";
import { createKifyInvoiceIssuer } from "@/lib/invoicing/kify-invoice-issuer";

const snapshot = { amountPaidCents: 121, balanceCents: 0, currency: "EUR" as const, dueDate: "2026-07-21", invoiceDate: "2026-07-21", invoiceId: "invoice-1", invoiceNumber: "KFY-2026-000001", issuer: { city: "Utrecht", countryCode: "NL", email: "invoice@example.test", legalName: "Kify", postalCode: "1234AB", streetAddress: "Street 1" }, lines: [{ description: "Subscription", grossCents: 121, netCents: 100, quantity: 1, vatCents: 21, vatRateBasisPoints: 2100 as const }], mode: "test" as const, paymentContext: { kind: "paid_first_installment" as const }, recipient: { city: "Utrecht", countryCode: "NL", email: "customer@example.test", legalName: "Customer", postalCode: "1234AB", streetAddress: "Street 2" }, schemaVersion: 1 as const, subtotalCents: 100, tenantId: "tenant-1", totalCents: 121, vatCents: 21 };

describe("Kify invoice issuer", () => {
  it("uses one claimed frozen snapshot through private storage before completion", async () => {
    const completed: string[] = [];
    const issuer = createKifyInvoiceIssuer({ artifactStore: createFakeInvoiceArtifactStore(), claim: async () => ({ attemptNumber: 1, snapshot, snapshotSha256: "frozen-hash" }), complete: async ({ invoiceId }) => { completed.push(invoiceId); }, fail: async () => assert.fail("must not fail"), renderer: createFakeInvoiceRenderer() });
    assert.deepEqual(await issuer.issue({ ownerId: "payment-1", ownerType: "payment", tenantId: "tenant-1" }), { invoiceId: "invoice-1", invoiceNumber: "KFY-2026-000001", status: "created" });
    assert.deepEqual(completed, ["invoice-1"]);
  });
});
