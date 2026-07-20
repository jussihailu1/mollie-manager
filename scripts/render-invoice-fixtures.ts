import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { nativePdfKitInvoiceRenderer } from "@/lib/invoicing/native-pdf-renderer";

void (async () => {
  const output = resolve(".artifacts/invoice-fixtures");
  await mkdir(output, { recursive: true });
  const base = { amountPaidCents: 121, balanceCents: 0, currency: "EUR" as const, dueDate: "2026-07-21", invoiceDate: "2026-07-21", invoiceId: "fixture", invoiceNumber: "TEST-KFY-2026-000001", issuer: { city: "Amsterdam", countryCode: "NL", email: "a@example.nl", legalName: "Uitgever B.V.", postalCode: "1000AA", streetAddress: "Damrak 1", vatId: "NL123" }, lines: [{ description: "Abonnement", grossCents: 121, netCents: 100, quantity: 1, vatCents: 21, vatRateBasisPoints: 2100 as const }], mode: "test" as const, recipient: { city: "Utrecht", countryCode: "NL", email: "b@example.nl", legalName: "Ontvanger B.V.", postalCode: "3500AA", streetAddress: "Oudegracht 1" }, schemaVersion: 1 as const, subtotalCents: 100, tenantId: "fixture", totalCents: 121, vatCents: 21 };
  const fixtures = [
    ["paid-first-installment", { ...base, paymentContext: { kind: "paid_first_installment" as const } }],
    ["automatic-collection", { ...base, amountPaidCents: 0, balanceCents: 121, paymentContext: { kind: "scheduled_collection" as const, plannedCollectionDate: "2026-07-26" } }],
    ["unicode-long-address", { ...base, issuer: { ...base.issuer, legalName: "Uitgever Één B.V. — dienstverlening", streetAddress: "Lange straat met Unicode en accenten 123-A" }, recipient: { ...base.recipient, legalName: "Klant Ångström 株式会社", streetAddress: "Zeer lange factuurstraat met uitgebreide toevoeging en verdieping 1234-B" }, paymentContext: { kind: "paid_first_installment" as const } }],
    ["multi-page", (() => { const lines = Array.from({ length: 30 }, (_, index) => ({ description: `Abonnement onderdeel ${index + 1}: uitgebreide omschrijving voor paginering`, grossCents: 121, netCents: 100, quantity: 1, vatCents: 21, vatRateBasisPoints: 2100 as const })); return { ...base, amountPaidCents: 3630, balanceCents: 0, lines, paymentContext: { kind: "paid_first_installment" as const }, subtotalCents: 3000, totalCents: 3630, vatCents: 630 }; })()],
  ] as const;
  for (const [name, snapshot] of fixtures) {
    const result = await nativePdfKitInvoiceRenderer.renderPdf(snapshot);
    const path = resolve(output, `${name}.pdf`);
    await writeFile(path, result.bytes);
    console.log(path);
  }
})();
