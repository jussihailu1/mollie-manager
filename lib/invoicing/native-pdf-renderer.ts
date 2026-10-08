import { createHash } from "node:crypto";
import { resolve } from "node:path";

import PDFDocument from "pdfkit";

import type { InvoiceDocumentRenderer, RenderedInvoiceDocument } from "@/lib/invoicing/invoice-renderer";
import { KOR_INVOICE_NOTICE } from "@/lib/invoicing/tax-treatment";

const regularFont = resolve(process.cwd(), "lib/invoicing/assets/NotoSans-Regular.ttf");
const boldFont = resolve(process.cwd(), "lib/invoicing/assets/NotoSans-Bold.ttf");

function euro(cents: number) {
  return new Intl.NumberFormat("nl-NL", { currency: "EUR", style: "currency" }).format(cents / 100);
}

function renderToBuffer(document: PDFKit.PDFDocument) {
  return new Promise<Buffer>((resolvePromise, reject) => {
    const chunks: Buffer[] = [];
    document.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    document.on("end", () => resolvePromise(Buffer.concat(chunks)));
    document.on("error", reject);
  });
}

function drawLineHeader(document: PDFKit.PDFDocument, kor: boolean) {
  document.font(boldFont).fontSize(10).text("Omschrijving", 48).text(kor ? "Bedrag" : "Bedrag incl. btw", 390, document.y - 12, { width: 150, align: "right" });
  document.font(regularFont);
}

export const nativePdfKitInvoiceRenderer: InvoiceDocumentRenderer = {
  id: "native-pdfkit-v1",
  validate(snapshot) {
    if (snapshot.currency !== "EUR" || snapshot.lines.length === 0 || snapshot.totalCents <= 0) throw new Error("Unsupported Kify PDF snapshot.");
    if (snapshot.subtotalCents + snapshot.vatCents !== snapshot.totalCents) throw new Error("Invoice totals are inconsistent.");
    if (snapshot.lines.reduce((sum, line) => sum + line.grossCents, 0) !== snapshot.totalCents) throw new Error("Invoice line total is inconsistent.");
    if (snapshot.lines.some((line) => line.netCents + line.vatCents !== line.grossCents)) throw new Error("Invoice line tax total is inconsistent.");
    if (snapshot.taxTreatment === "kor" && (snapshot.vatCents !== 0 || snapshot.lines.some((line) => line.vatRateBasisPoints !== 0))) throw new Error("KOR invoices cannot contain VAT.");
    if (snapshot.taxTreatment === "standard" && snapshot.lines.some((line) => line.vatRateBasisPoints !== 2100)) throw new Error("Standard invoices require 21% VAT lines.");
  },
  async renderPdf(snapshot): Promise<RenderedInvoiceDocument> {
    this.validate(snapshot);
    const kor = snapshot.taxTreatment === "kor";
    const document = new PDFDocument({ autoFirstPage: true, margin: 48, size: "A4" });
    document.on("pageAdded", () => drawLineHeader(document, kor));
    const output = renderToBuffer(document);
    document.info.Title = `Factuur ${snapshot.invoiceNumber}`;
    document.info.Author = snapshot.issuer.legalName;
    document.info.Subject = `Kify factuur ${snapshot.invoiceNumber}`;
    document.font(regularFont);
    document.font(boldFont).fontSize(20).text("FACTUUR");
    document.font(regularFont).fontSize(10).text(`Factuurnummer: ${snapshot.invoiceNumber}`);
    document.text(`Factuurdatum: ${snapshot.invoiceDate}`);
    document.text(`Vervaldatum: ${snapshot.dueDate}`);
    document.moveDown();
    document.font(boldFont).text("Van");
    document.font(regularFont).text(`${snapshot.issuer.legalName}\n${snapshot.issuer.streetAddress}\n${snapshot.issuer.postalCode} ${snapshot.issuer.city}\n${snapshot.issuer.countryCode}\nKvK/BTW: ${snapshot.issuer.vatId ?? "-"}`);
    document.moveDown();
    document.font(boldFont).text("Aan");
    document.font(regularFont).text(`${snapshot.recipient.legalName}\n${snapshot.recipient.streetAddress}\n${snapshot.recipient.postalCode} ${snapshot.recipient.city}\n${snapshot.recipient.countryCode}`);
    document.moveDown();
    drawLineHeader(document, kor);
    for (const line of snapshot.lines) {
      const y = document.y + 8;
      document.text(kor ? `${line.description} (${line.quantity} ×)` : `${line.description} (${line.quantity} × 21% btw)`, 48, y, { width: 320 });
      document.text(euro(line.grossCents), 390, y, { width: 150, align: "right" });
      document.moveDown();
    }
    document.moveDown();
    if (!kor) {
      document.text(`Subtotaal excl. btw: ${euro(snapshot.subtotalCents)}`, { align: "right" });
      document.text(`Btw 21%: ${euro(snapshot.vatCents)}`, { align: "right" });
    }
    document.font(boldFont).text(`${kor ? "Totaal" : "Totaal incl. btw"}: ${euro(snapshot.totalCents)}`, { align: "right" });
    document.font(regularFont).moveDown();
    if (kor) document.text(KOR_INVOICE_NOTICE);
    document.text(snapshot.paymentContext.kind === "scheduled_collection" ? `Dit bedrag wordt automatisch geïncasseerd op ${snapshot.paymentContext.plannedCollectionDate}.` : "Deze factuur is betaald.");
    document.fontSize(8).fillColor("#555555").text(`Kify documenthash: ${createHash("sha256").update(JSON.stringify(snapshot)).digest("hex")}`, 48, 780, { width: 500, align: "center" });
    document.end();
    return { bytes: await output, contentType: "application/pdf", rendererId: this.id };
  },
};
