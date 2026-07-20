import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { nativePdfKitInvoiceRenderer } from "@/lib/invoicing/native-pdf-renderer";

void (async () => {
  const output = resolve(".artifacts/invoice-fixtures");
  await mkdir(output, { recursive: true });
  const snapshot = { amountPaidCents: 121, balanceCents: 0, currency: "EUR" as const, dueDate: "2026-07-21", invoiceDate: "2026-07-21", invoiceId: "fixture", invoiceNumber: "TEST-KFY-2026-000001", issuer: { city: "Amsterdam", countryCode: "NL", email: "a@example.nl", legalName: "Uitgever B.V.", postalCode: "1000AA", streetAddress: "Damrak 1", vatId: "NL123" }, lines: [{ description: "Abonnement", grossCents: 121, netCents: 100, quantity: 1, vatCents: 21, vatRateBasisPoints: 2100 as const }], mode: "test" as const, paymentContext: { kind: "paid_first_installment" as const }, recipient: { city: "Utrecht", countryCode: "NL", email: "b@example.nl", legalName: "Ontvanger B.V.", postalCode: "3500AA", streetAddress: "Oudegracht 1" }, schemaVersion: 1 as const, subtotalCents: 100, tenantId: "fixture", totalCents: 121, vatCents: 21 };
  const result = await nativePdfKitInvoiceRenderer.renderPdf(snapshot);
  await writeFile(resolve(output, "paid-first-installment.pdf"), result.bytes);
  console.log(resolve(output, "paid-first-installment.pdf"));
})();
