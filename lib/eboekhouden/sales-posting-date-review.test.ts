import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as reviews from "@/lib/eboekhouden/sales-posting-date-review";
import * as previews from "@/lib/eboekhouden/sales-posting-preview";
import * as pagination from "@/lib/eboekhouden/pagination";
import type { EboekhoudenInvoice, EboekhoudenLedger } from "@/lib/eboekhouden/client";

const scope = { tenantId: "00000000-0000-4000-8000-000000000001", mode: "live" };
const local: previews.LocalPostingInvoice = {
  localInvoiceId: "schedule:test", providerInvoiceId: "42", invoiceNumber: "TEST-42", relationId: 5,
  reference: "RB-test-260610", invoiceDate: "2026-06-05", amountValue: "19.99", currency: "EUR",
};
const invoice: EboekhoudenInvoice = {
  id: 42, invoiceNumber: "TEST-42", relationId: 5, reference: local.reference, date: "2026-06-01", termOfPayment: 9,
  inExVat: "EX", totalAmount: 19.99, totalExcl: 19.99, vatAmount: 0,
  items: [{ ledgerId: 20, quantity: 1, pricePerUnit: 19.99, vatCode: "GEEN", description: "Test subscription" }],
};
const ledgers: EboekhoudenLedger[] = [{ id: 10, category: "DEB" }, { id: 20, category: "VW" }];
const dateReview: reviews.InvoiceDateReview = {
  localInvoiceId: local.localInvoiceId, providerInvoiceId: local.providerInvoiceId, invoiceNumber: local.invoiceNumber,
  relationId: local.relationId, reference: local.reference, amountValue: local.amountValue, currency: "EUR",
  scheduledInvoiceDate: local.invoiceDate, originalInvoiceDate: "2026-06-01", termOfPayment: 9, collectionDate: "2026-06-10",
  evidence: [{ source: "test-evidence.json", sha256: "a".repeat(64) }], reason: "Original document and issuance evidence agree.",
};
const manifest = { version: 1, purpose: "read-only-sales-posting-preview", ...scope, reviewedAt: "2026-11-10T21:35:06.199Z", reviews: [dateReview] };
const preview = (changes: Partial<Parameters<typeof previews.previewSalesPosting>[0]> = {}) => previews.previewSalesPosting({
  local, invoice, ledgers, mutations: [], outstanding: [], dateReview, ...changes,
});

describe("reviewed original invoice dates", () => {
  it("retains the original document and visible mismatch while proposing its original date and term", () => {
    const before = JSON.stringify({ local, invoice, manifest });
    const result = preview({ dateReview: reviews.parseInvoiceDateReviews(manifest, scope).reviews[0] });
    assert.equal(result.status, "missing_sales_posting");
    assert.equal(result.proposedMutation?.date, "2026-06-01");
    assert.equal(result.proposedMutation?.termOfPayment, 9);
    assert.deepEqual(result.identityDifferences, [{ field: "date", expected: "2026-06-05", actual: "2026-06-01" }]);
    assert.deepEqual(result.acceptedDateReview, dateReview);
    assert.equal(JSON.stringify({ local, invoice, manifest }), before);
    assert.equal(preview({ dateReview: undefined }).status, "review_required");
  });

  it("rejects a review from another tenant/mode and rejects duplicate or malformed evidence", () => {
    for (const change of [{ tenantId: "00000000-0000-4000-8000-000000000002" }, { mode: "test" }]) {
      assert.throws(() => reviews.parseInvoiceDateReviews({ ...manifest, ...change }, scope), /tenant and mode/);
    }
    for (const key of ["localInvoiceId", "providerInvoiceId", "invoiceNumber"] as const) {
      const other = { ...dateReview, localInvoiceId: "other", providerInvoiceId: "43", invoiceNumber: "TEST-43", [key]: dateReview[key] };
      assert.throws(() => reviews.parseInvoiceDateReviews({ ...manifest, reviews: [dateReview, other] }, scope), /duplicate/);
    }
    for (const change of [
      { originalInvoiceDate: "2026-02-30" }, { termOfPayment: 10 }, { collectionDate: "2026-06-11" },
      { evidence: [] }, { reason: " " }, { currency: "USD" }, { amountValue: "NaN" }, { apply: true },
    ]) assert.throws(() => reviews.parseInvoiceDateReviews({ ...manifest, reviews: [{ ...dateReview, ...change }] }, scope), /Invalid/);
    assert.throws(() => reviews.parseInvoiceDateReviews({ ...manifest, apply: true }, scope), /Invalid/);
  });

  it("holds a stale or misassigned review for every bound local identity field", () => {
    for (const change of [
      { localInvoiceId: "other" }, { providerInvoiceId: "43" }, { invoiceNumber: "TEST-43" }, { relationId: 6 },
      { reference: "other" }, { invoiceDate: "2026-06-06" }, { amountValue: "20.00" }, { currency: "USD" },
    ]) {
      const result = preview({ local: { ...local, ...change } });
      assert.equal(result.status, "review_required");
      assert.equal(result.acceptedDateReview, null);
      assert.equal(result.proposedMutation, null);
    }
  });

  it("holds a changed provider identity, original date, amount or payment term", () => {
    for (const change of [
      { id: 43 }, { invoiceNumber: "TEST-43" }, { relationId: 6 }, { reference: "other" },
      { date: "2026-06-02" }, { totalAmount: 20 }, { termOfPayment: 10 }, { termOfPayment: undefined },
    ]) assert.equal(preview({ invoice: { ...invoice, ...change } }).status, "review_required");
  });

  it("still blocks duplicate, mismatched, manual, outstanding and credit entries after accepting the date", () => {
    const sale = { id: 91, type: 2, date: invoice.date!, invoiceNumber: invoice.invoiceNumber!, relationId: 5,
      ledgerId: 10, inExVat: "EX", rows: [{ ledgerId: 20, amount: 19.99, vatCode: "GEEN" }] };
    assert.equal(preview({ mutations: [sale] }).status, "already_posted");
    for (const change of [
      { mutations: [sale, { ...sale, id: 92 }] }, { mutations: [{ ...sale, date: local.invoiceDate }] },
      { mutations: [{ ...sale, type: 5, invoiceNumber: undefined, relationId: undefined }] },
      { outstanding: [{ invoiceNumber: local.invoiceNumber, relationId: 5, mutationId: 91 }] },
      { otherInvoices: [{ ...invoice, id: 43, totalAmount: -19.99 }] },
      { ledgers: ledgers.filter(ledger => ledger.category !== "DEB") },
      { invoice: { ...invoice, items: [{ ...invoice.items![0], discountAmount: 1 }] } },
    ]) {
      const result = preview(change);
      assert.equal(result.status, "review_required");
      assert.equal(result.proposedMutation, null);
    }
  });
});

// Execute the CLI with in-memory DB/files/HTTP boundaries. No credentials or network.
async function runPreviewCli(options: { manifest?: unknown; args?: string[] } = {}) {
  const calls: { path: string; method: string }[] = [];
  const queries: string[] = [];
  let output = "";
  let error = "";
  let dbConnections = 0;
  const json = JSON.stringify(options.manifest ?? manifest);
  const fakeProcess = { argv: ["node", "preview.ts", "--tenant-id", scope.tenantId, "--mode", scope.mode,
    "--reviewed-dates", "review.json", "--output", "report.json", ...options.args ?? []], env: {}, exitCode: 0 };
  const modules: Record<string, unknown> = {
    "node:fs/promises": { readFile: async () => Buffer.from(json), mkdir: async () => {}, writeFile: async (_path: string, contents: string, options: { flag: string }) => {
      assert.equal(options.flag, "wx"); output = contents;
    } },
    "node:crypto": { createHash }, "node:path": { dirname: () => ".", resolve: (path: string) => path },
    "node:process": fakeProcess,
    "pg": { Client: class {
      constructor(input: { options: string }) { assert.equal(input.options, "-c default_transaction_read_only=on"); }
      async connect() { dbConnections++; }
      async end() {}
      async query(sql: string) {
        queries.push(sql);
        if (sql === "SHOW transaction_read_only") return { rows: [{ transaction_read_only: "on" }] };
        if (sql.includes("api_token_ciphertext")) return { rows: [{ api_source: "test", api_token_ciphertext: "test" }] };
        if (sql.includes("from invoices i")) return { rows: [local] };
        return { rows: [] };
      }
    } },
    "../lib/tenant-credential-encryption": { decryptTenantCredential: () => "test-only" },
    "../lib/eboekhouden/pagination": pagination,
    "../lib/eboekhouden/sales-posting-preview": previews,
    "../lib/eboekhouden/sales-posting-date-review": reviews,
  };
  const source = ts.transpileModule(readFileSync("scripts/preview-eboekhouden-sales-posting.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText.replace("void main().catch", "globalThis.completion = main().catch");
  const context: Record<string, unknown> = {
    exports: {}, Buffer, AbortSignal, Error, console: { log: () => {}, error: (message: string) => { error = message; } },
    require: (id: string) => { assert.ok(id in modules, `Unexpected dependency: ${id}`); return modules[id]; },
    fetch: async (url: string, input: RequestInit) => {
      const path = new URL(url).pathname;
      calls.push({ path, method: input.method! });
      if (path === "/v1/session") return Response.json({ token: "test-only" });
      assert.equal(input.method, "GET");
      if (path === "/v1/ledger") return Response.json({ items: ledgers });
      if (path === "/v1/invoice") return Response.json({ items: [invoice] });
      if (path === "/v1/invoice/42") return Response.json(invoice);
      if (["/v1/mutation", "/v1/mutation/invoice/outstanding"].includes(path)) return Response.json({ items: [] });
      assert.fail(`Unexpected request: ${path}`);
    },
  };
  runInNewContext(source, context);
  assert.ok(context.completion && typeof (context.completion as Promise<void>).then === "function");
  await context.completion;
  return { calls, queries, output, error, dbConnections, exitCode: fakeProcess.exitCode, json };
}

describe("read-only preview CLI with reviewed dates", () => {
  it("uses read-only DB and accounting GETs, preserves evidence and never creates financial entries", async () => {
    const result = await runPreviewCli();
    assert.equal(result.exitCode, 0, result.error);
    assert.ok(result.queries.includes("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"));
    assert.ok(result.queries.includes("ROLLBACK"));
    assert.deepEqual(result.calls.filter(call => call.method !== "GET"), [{ path: "/v1/session", method: "POST" }]);
    const report = JSON.parse(result.output);
    assert.equal(report.readOnly.financialWrites, 0);
    assert.equal(report.summary.acceptedDateReviews, 1);
    assert.equal(report.summary.missing, 1);
    assert.equal(report.previews[0].proposedMutation.date, "2026-06-01");
    assert.equal(report.reviewedDates.manifestSha256, createHash("sha256").update(result.json).digest("hex"));
    assert.deepEqual(report.reviewedDates.reviews, manifest.reviews);
  });

  it("rejects cross-tenant evidence and an apply flag before connecting", async () => {
    for (const options of [{ manifest: { ...manifest, mode: "test" } }, { args: ["--apply", "true"] }]) {
      const result = await runPreviewCli(options);
      assert.equal(result.exitCode, 1);
      assert.equal(result.dbConnections, 0);
      assert.equal(result.calls.length, 0);
      assert.equal(result.output, "");
    }
  });

  it("rejects unused date reviews before provider access", async () => {
    const result = await runPreviewCli({ manifest: { ...manifest, reviews: [{ ...dateReview, localInvoiceId: "missing" }] } });
    assert.equal(result.exitCode, 1);
    assert.match(result.error, /absent or ambiguous/);
    assert.ok(result.queries.includes("ROLLBACK"));
    assert.equal(result.calls.length, 0);
    assert.equal(result.output, "");
  });
});
