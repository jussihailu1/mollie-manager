import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nativePdfKitInvoiceRenderer } from "@/lib/invoicing/native-pdf-renderer";
import type { CanonicalInvoiceSnapshot } from "@/lib/invoicing/invoice-renderer";

const snapshot: CanonicalInvoiceSnapshot = { amountPaidCents: 121, balanceCents: 0, currency: "EUR", dueDate: "2026-07-21", invoiceDate: "2026-07-21", invoiceId: "i", invoiceNumber: "TEST-KFY-2026-000001", issuer: { city: "Amsterdam", countryCode: "NL", email: "a@example.nl", legalName: "Uitgever B.V.", postalCode: "1000AA", streetAddress: "Damrak 1", vatId: "NL123" }, lines: [{ description: "Abonnement", grossCents: 121, netCents: 100, quantity: 1, vatCents: 21, vatRateBasisPoints: 2100 }], mode: "test", paymentContext: { kind: "paid_first_installment" }, recipient: { city: "Utrecht", countryCode: "NL", email: "b@example.nl", legalName: "Ontvanger B.V.", postalCode: "3500AA", streetAddress: "Oudegracht 1" }, schemaVersion: 1, subtotalCents: 100, tenantId: "t", totalCents: 121, vatCents: 21 };

describe("native PDFKit invoice renderer", () => {
  it("renders embedded-font PDF without network access", async () => {
    const result = await nativePdfKitInvoiceRenderer.renderPdf(snapshot);
    assert.equal(result.contentType, "application/pdf");
    assert.ok(result.bytes.subarray(0, 5).equals(Buffer.from("%PDF-")));
    assert.ok(result.bytes.byteLength > 1000 && result.bytes.byteLength < 5 * 1024 * 1024);
  });
  it("renders a KOR invoice and rejects any KOR VAT", async () => {
    const kor = {
      ...snapshot,
      taxTreatment: "kor" as const,
      subtotalCents: 1999,
      totalCents: 1999,
      amountPaidCents: 1999,
      vatCents: 0,
      lines: [{ description: "Hosting", grossCents: 1999, netCents: 1999, quantity: 1, vatCents: 0, vatRateBasisPoints: 0 as const }],
    };
    const result = await nativePdfKitInvoiceRenderer.renderPdf(kor);
    assert.ok(result.bytes.subarray(0, 5).equals(Buffer.from("%PDF-")));
    assert.throws(() => nativePdfKitInvoiceRenderer.validate({
      ...kor,
      subtotalCents: 1998,
      vatCents: 1,
      lines: [{ ...kor.lines[0], netCents: 1998, vatCents: 1 }],
    }), /cannot contain VAT/);
  });
});
