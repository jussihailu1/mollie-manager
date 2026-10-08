import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

import * as validation from "@/lib/eboekhouden/invoice-total-validation";
import * as tax from "@/lib/invoicing/tax-treatment";
import * as pdf from "@/lib/invoice-pdf";
import * as retry from "@/lib/invoice-delivery-retry";
import type { EboekhoudenInvoice } from "@/lib/eboekhouden/client";
import type { DeliveryInput } from "@/lib/invoice-delivery-batch";

function loadIsolated<T>(file: string, modules: Record<string, unknown>): T {
  const source = readFileSync(file, "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  runInNewContext(js, { exports, Error, Date, Buffer, require: (id: string) => {
    assert.ok(id in modules, `Unexpected dependency ${id}`);
    return modules[id];
  } });
  return exports as T;
}

const invoice: EboekhoudenInvoice = {
  id: 42, invoiceNumber: "F00054", relationId: 10, reference: "RB-1",
  totalAmount: 19.99, vatAmount: 0,
  urlPdfFile: "https://api.e-boekhouden.nl/current.pdf",
};
function verifier(getInvoice: () => Promise<EboekhoudenInvoice>) {
  return loadIsolated<typeof import("@/lib/eboekhouden/invoice-total-verification")>("lib/eboekhouden/invoice-total-verification.ts", {
    "@/lib/eboekhouden/client": { getEboekhoudenInvoice: async (id: number, tenantId: string) => {
      assert.equal(id, 42); assert.equal(tenantId, "tenant-1");
      return getInvoice();
    } },
    "@/lib/eboekhouden/invoice-total-validation": validation,
    "@/lib/invoicing/tax-treatment": tax,
  });
}
const request = { expectedAmount: "19.99", expectedRelationId: 10, expectedReference: "RB-1", invoice: { id: 42 }, taxTreatment: "kor" as const, tenantId: "tenant-1" };

describe("e-Boekhouden API verification", () => {
  it("verifies the API without fetching or parsing a PDF, even while the PDF is unavailable", async () => {
    const result = await verifier(async () => ({ ...invoice, urlPdfFile: null })).verifiedEboekhoudenInvoice(request);
    assert.equal(result.apiVerification.expectedAmount, "19.99");
    assert.equal(result.apiVerification.taxTreatment, "kor");
    assert.ok(result.apiVerification.verifiedAt);
    assert.equal("appVerification" in result, false);
    assert.equal("pdfSha256" in result.apiVerification, false);
  });
  it("rejects amount, VAT and expected-identity mismatches", async () => {
    for (const changed of [{ totalAmount: 24.19 }, { vatAmount: 3.47 }, { id: 43 }, { relationId: 11 }, { reference: "RB-other" }, { invoiceNumber: "" }]) {
      await assert.rejects(() => verifier(async () => ({ ...invoice, ...changed })).verifiedEboekhoudenInvoice(request));
    }
  });
  it("rechecks the original treatment and identity on delivery, accepting a new document URL", async () => {
    const original = await verifier(async () => invoice).verifiedEboekhoudenInvoice(request);
    const deliveryInput = { providerInvoiceId: "42", providerInvoiceNumber: "F00054", providerSnapshot: original, tenantId: "tenant-1" };
    const result = await verifier(async () => ({ ...invoice, urlPdfFile: "https://api.e-boekhouden.nl/regenerated.pdf" })).verifiedEboekhoudenInvoiceForDelivery(deliveryInput);
    assert.equal(result.urlPdfFile, "https://api.e-boekhouden.nl/regenerated.pdf");
    for (const changed of [{ totalAmount: 24.19 }, { vatAmount: 3.47 }, { invoiceNumber: "F00055" }, { relationId: 11 }, { reference: "other" }]) {
      await assert.rejects(() => verifier(async () => ({ ...invoice, ...changed })).verifiedEboekhoudenInvoiceForDelivery(deliveryInput));
    }
    await assert.rejects(() => verifier(async () => invoice).verifiedEboekhoudenInvoiceForDelivery({ ...deliveryInput, providerSnapshot: invoice }), /no verified issuance/);
  });
});

const deliveryInput: DeliveryInput = {
  actor: { kind: "system" }, customerEmail: "customer@example.test", customerId: "customer-1",
  entityId: "schedule-1", invoiceId: "42", invoiceNumber: "F00054", invoiceProvider: "eboekhouden",
  invoiceDocumentUrl: "https://api.e-boekhouden.nl/stale.pdf", invoiceType: "recurring",
  mode: "live", subscriptionId: "subscription-1", tenantId: "tenant-1",
};

async function deliver(options: { body?: string; apiFailure?: boolean } = {}) {
  const snapshot = await verifier(async () => invoice).verifiedEboekhoudenInvoice(request);
  const fetched: string[] = [], sent: unknown[] = [], writes: string[] = [];
  const api = verifier(async () => {
    if (options.apiFailure) throw new Error("Provider API unavailable");
    return invoice;
  });
  const db = { execute: async (query: string) => { writes.push(query); return { rows: [{ metadata: {} }] }; } };
  const runtime = loadIsolated<typeof import("@/lib/invoice-delivery")>("lib/invoice-delivery.ts", {
    "server-only": {},
    "drizzle-orm": { sql: (strings: TemplateStringsArray) => strings.join("?") },
    "@/lib/audit": { writeAuditLog: async () => {} },
    "@/lib/db": { getDb: () => db, transaction: async (fn: (tx: typeof db) => Promise<unknown>) => fn(db) },
    "@/lib/eboekhouden/invoice-total-verification": api,
    "@/lib/env": { env: { APP_URL: "https://example.test" } },
    "@/lib/invoices": { getStoredInvoiceByOwner: async () => ({ id: "local-1", mode: "live", provider: "eboekhouden", providerInvoiceId: "42", providerInvoiceNumber: "F00054", providerSnapshot: snapshot }) },
    "@/lib/invoice-delivery-retry": retry,
    "@/lib/invoice-delivery-batch": {},
    "@/lib/invoicing/provider-resolver": {},
    "@/lib/invoicing/invoice-document-runtime": { invoiceDocumentService: { getDocument: () => { throw new Error("Must use freshly verified provider URL"); } } },
    "@/lib/invoice-pdf": { ...pdf, buildTrustedInvoicePdfAttachment: (input: Parameters<typeof pdf.buildTrustedInvoicePdfAttachment>[0]) => pdf.buildTrustedInvoicePdfAttachment({ ...input, fetchImpl: async url => {
      fetched.push(String(url));
      return new Response(options.body ?? "%PDF-1.7\nregenerated metadata and different bytes", { headers: { "content-type": "application/pdf" } });
    } }) },
    "@/lib/notifications/email": { sendEmailTo: async (input: unknown) => { sent.push(input); } },
    "@/lib/reliability/alerts": { openAlert: async () => ({ isNew: false }) },
  });
  return { result: await runtime.deliverCustomerInvoiceEmail(deliveryInput), fetched, sent, writes };
}

describe("e-Boekhouden delivery without semantic PDF parsing", () => {
  it("sends the fresh provider attachment without a PDF parser or hash stamp", async () => {
    const result = await deliver();
    assert.equal(result.result.status, "sent");
    assert.equal(result.sent.length, 1);
    assert.deepEqual(result.fetched, [invoice.urlPdfFile]);
  });
  it("keeps an invalid attachment as a delivery failure, without resetting invoice creation", async () => {
    const result = await deliver({ body: "not a PDF" });
    assert.equal(result.result.status, "failed");
    assert.equal(result.sent.length, 0);
    assert.ok(result.writes.some(query => query.includes("update recurring_billing_schedules")));
    assert.ok(result.writes.every(query => !/invoice_state\s*=\s*'(?:pending_invoice|invoice_failed|invoice_creating)'/.test(query)));
  });
  it("does not download or send when API verification is unavailable", async () => {
    const result = await deliver({ apiFailure: true });
    assert.equal(result.result.status, "failed");
    assert.equal(result.sent.length, 0);
    assert.equal(result.fetched.length, 0);
  });
});
