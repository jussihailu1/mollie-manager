import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as posting from "@/lib/eboekhouden/invoice-posting";
import * as pagination from "@/lib/eboekhouden/pagination";
import * as flow from "@/lib/eboekhouden/invoice-flow-helpers";
import { previewSalesPosting, type LocalPostingInvoice } from "@/lib/eboekhouden/sales-posting-preview";
import type { EboekhoudenCreateInvoiceInput, EboekhoudenInvoice, EboekhoudenLedger } from "@/lib/eboekhouden/client";

const ledgers: EboekhoudenLedger[] = [{ id: 10, category: "DEB", code: "1300" }, { id: 20, category: "VW", code: "8010" }, { id: 30, category: "FIN", code: "1000" }];
const payload: EboekhoudenCreateInvoiceInput = {
  date: "2026-11-01", inExVat: "IN", reference: "RB-12345678-261101", relationId: 5, templateId: 6,
  termOfPayment: 9, print: false, items: [{ ledgerId: 20, pricePerUnit: 19.99, quantity: 1, description: "Subscription", vatCode: "GEEN" }],
};
const invoice: EboekhoudenInvoice = { ...payload, id: 42, invoiceNumber: "F00057", totalAmount: 19.99, totalExcl: 19.99, vatAmount: 0 };
const sale: posting.SalesMutation = { id: 91, type: 2, date: payload.date, invoiceNumber: invoice.invoiceNumber!, relationId: 5, ledgerId: 10, inExVat: "IN", rows: [{ ledgerId: 20, amount: 19.99, vatCode: "GEEN" }] };
const local: LocalPostingInvoice = { localInvoiceId: "local-1", providerInvoiceId: "42", invoiceNumber: "F00057", reference: payload.reference!, relationId: 5, invoiceDate: payload.date, amountValue: "19.99", currency: "EUR" };

function load<T>(file: string, modules: Record<string, unknown>, globals: Record<string, unknown> = {}): T {
  const js = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  runInNewContext(js, { exports, Error, Date, URLSearchParams, AbortSignal, ...globals, require: (id: string) => {
    assert.ok(id in modules, `Unexpected dependency: ${id}`);
    return modules[id];
  } });
  return exports as T;
}

describe("sales posting payload", () => {
  it("posts the debtor header and original revenue line in the same invoice request", () => {
    for (const reference of ["FP-12345678-261101", "RB-12345678-261101"]) {
      const result = posting.buildPostedInvoicePayload({ ...payload, reference }, ledgers);
      assert.deepEqual(result.mutation, { ledgerId: 10, description: `Kify ${reference}`, paymentReference: reference, checkPaymentReference: true });
      assert.equal(result.items, payload.items);
      assert.equal(result.termOfPayment, 9);
      assert.equal("email" in result, false);
      assert.equal("directDebit" in result, false);
    }
  });
  it("preserves standard VAT and inclusive prices", () => {
    const items = [{ ...payload.items[0], vatCode: "HOOG_VERK_21" }];
    const result = posting.buildPostedInvoicePayload({ ...payload, items }, ledgers);
    assert.equal(result.items[0].pricePerUnit, 19.99);
    assert.equal(result.items[0].vatCode, "HOOG_VERK_21");
  });
  it("fails closed for absent/ambiguous debtor mappings, invalid revenue ledgers and unstable references", () => {
    for (const mapping of [[], ledgers.filter(row => row.id !== 10), [...ledgers, { id: 11, category: "DEB" }]]) {
      assert.throws(() => posting.buildPostedInvoicePayload(payload, mapping), /debtor ledger/);
    }
    for (const ledgerId of [10, 30, 999]) assert.throws(() => posting.buildPostedInvoicePayload({ ...payload, items: [{ ...payload.items[0], ledgerId }] }, ledgers), /ledger/);
    for (const reference of [undefined, "", "  ", " padded", "x".repeat(51)]) assert.throws(() => posting.buildPostedInvoicePayload({ ...payload, reference }, ledgers), /reference/);
  });
});

describe("actual invoice HTTP boundary (isolated)", () => {
  async function clientScenario(options: { ledgerList?: EboekhoudenLedger[]; reference?: string; uncertain?: boolean; duplicate?: boolean } = {}) {
    const calls: { path: string; method: string; body?: Record<string, unknown>; authorization?: string }[] = [];
    const client = load<typeof import("@/lib/eboekhouden/client")>("lib/eboekhouden/client.ts", {
      "server-only": {}, "zod": { ZodError: class extends Error {} },
      "@/lib/eboekhouden/tenant-credentials": { TenantEboekhoudenCredentialError: class extends Error {}, resolveTenantEboekhoudenConfig: async (tenantId: string) => {
        assert.equal(tenantId, "tenant-1"); return { EBOEKHOUDEN_API_TOKEN: "test-only-token", EBOEKHOUDEN_API_SOURCE: "KifyTest" };
      } },
      "@/lib/eboekhouden/invoice-posting": posting,
      "@/lib/eboekhouden/pagination": pagination,
      "@/lib/eboekhouden/invoice-flow-helpers": flow,
    }, { fetch: async (url: string, init: RequestInit) => {
      const path = new URL(url).pathname;
      calls.push({ path, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined, authorization: (init.headers as Record<string, string>).Authorization });
      if (path === "/v1/session") return Response.json({ token: "test-session", expiresIn: 60 });
      if (path === "/v1/ledger") return Response.json({ items: options.ledgerList ?? ledgers, count: 3 });
      assert.equal(path, "/v1/invoice");
      if (options.uncertain) throw new Error("Network outcome unknown");
      if (options.duplicate) return Response.json({ code: "FACT_VERWERK_004", message: "Payment reference already exists" }, { status: 400 });
      return Response.json({ id: 42, invoiceNumber: "F00057" }, { status: 201 });
    } });
    let error: unknown;
    try { await client.createEboekhoudenInvoice({ ...payload, reference: options.reference ?? payload.reference }, "tenant-1"); } catch (caught) { error = caught; }
    return { calls, error };
  }
  it("always includes posting and makes no separate mutation POST", async () => {
    const result = await clientScenario();
    assert.equal(result.error, undefined);
    const writes = result.calls.filter(call => call.method === "POST" && call.path !== "/v1/session");
    assert.equal(writes.length, 1);
    assert.deepEqual(writes[0].body?.mutation, { ledgerId: 10, description: `Kify ${payload.reference}`, paymentReference: payload.reference, checkPaymentReference: true });
    assert.equal(writes[0].authorization, "test-session");
  });
  it("does not POST an invoice after mapping/reference validation fails", async () => {
    for (const options of [{ ledgerList: [] }, { reference: " " }]) {
      const result = await clientScenario(options);
      assert.ok(result.error);
      assert.equal(result.calls.some(call => call.path === "/v1/invoice"), false);
    }
  });
  it("never retries uncertain or duplicate-reference invoice writes", async () => {
    for (const options of [{ uncertain: true }, { duplicate: true }]) {
      const result = await clientScenario(options);
      assert.ok(result.error);
      assert.equal(result.calls.filter(call => call.path === "/v1/invoice").length, 1);
    }
  });
});

describe("posting verification", () => {
  it("accepts exact paid or unpaid sales, independent of the outstanding-debtor list", () => {
    posting.assertInvoiceSalesMutation(invoice, sale, ledgers);
    posting.assertInvoiceSalesMutation(invoice, { ...sale, inExVat: "EX" }, ledgers);
  });
  it("rejects different customer, amount, date, VAT, revenue account or debtor account", () => {
    for (const change of [{ type: 3 }, { relationId: 6 }, { date: "2026-11-02" }, { invoiceNumber: "F00058" }, { ledgerId: 30 }, { inExVat: "invalid" },
      { rows: [{ ...sale.rows![0], amount: 20 }] }, { rows: [{ ...sale.rows![0], vatCode: "HOOG_VERK_21" }] }, { rows: [{ ...sale.rows![0], ledgerId: 30 }] }]) {
      assert.throws(() => posting.assertInvoiceSalesMutation(invoice, { ...sale, ...change }, ledgers));
    }
  });
  it("uses tenant-scoped detail reads and rejects missing/duplicate postings", async () => {
    for (const entries of [[], [sale], [sale, { ...sale, id: 92 }]]) {
      let details = 0;
      const verifier = load<typeof import("@/lib/eboekhouden/invoice-posting-verification")>("lib/eboekhouden/invoice-posting-verification.ts", {
        "@/lib/eboekhouden/client": {
          listEboekhoudenSalesMutations: async (options: { invoiceNumber: string; tenantId: string }) => { assert.equal(options.tenantId, "tenant-1"); assert.equal(options.invoiceNumber, "F00057"); return { items: entries }; },
          listEboekhoudenLedgers: async (options: { tenantId: string }) => { assert.equal(options.tenantId, "tenant-1"); return { items: ledgers }; },
          getEboekhoudenMutation: async (id: number, tenant: string) => { assert.equal(id, 91); assert.equal(tenant, "tenant-1"); details++; return sale; },
        },
        "@/lib/eboekhouden/invoice-posting": posting,
        "@/lib/eboekhouden/pagination": pagination,
      });
      if (entries.length === 1) { assert.equal((await verifier.verifyInvoiceSalesPosting(invoice, "tenant-1")).mutationId, 91); assert.equal(details, 1); }
      else await assert.rejects(() => verifier.verifyInvoiceSalesPosting(invoice, "tenant-1"), /exactly one/);
    }
  });
});

describe("read-only historical repair decisions", () => {
  const preview = (changes: Partial<Parameters<typeof previewSalesPosting>[0]> = {}) => previewSalesPosting({ local, invoice, ledgers, mutations: [], outstanding: [], ...changes });
  it("proposes only the missing sale, preserving original invoice number, date, amount, VAT and reference", () => {
    const result = preview();
    assert.equal(result.status, "missing_sales_posting");
    assert.equal(result.proposedMutation?.type, 2);
    assert.equal(result.proposedMutation?.invoiceNumber, "F00057");
    assert.equal(result.proposedMutation?.date, "2026-11-01");
    assert.equal(result.proposedMutation?.paymentReference, payload.reference);
    assert.equal(result.proposedMutation?.rows[0].vatCode, "GEEN");
    assert.equal(result.proposedMutation?.rows[0].amount, 19.99);
  });
  it("never proposes a duplicate for a matching sale, even if it is fully paid", () => {
    assert.equal(preview({ mutations: [sale] }).status, "already_posted");
    assert.equal(preview({ mutations: [sale] }).proposedMutation, null);
  });
  it("holds duplicate/mismatched sales, referenced payments and possible manual bank revenue", () => {
    for (const mutations of [[sale, { ...sale, id: 92 }], [{ ...sale, relationId: 99 }], [{ ...sale, type: 3 }], [{ ...sale, type: 5, invoiceNumber: undefined, relationId: undefined }]]) {
      const result = preview({ mutations });
      assert.equal(result.status, "review_required");
      assert.equal(result.proposedMutation, null);
    }
  });
  it("holds changed document/owner identity, discounts, incomplete data and related credit notes", () => {
    for (const changes of [{ invoice: { ...invoice, totalAmount: 20 } }, { local: { ...local, relationId: 99 } }, { local: { ...local, currency: "USD" } },
      { invoice: { ...invoice, items: undefined } }, { invoice: { ...invoice, items: [{ ...payload.items[0], discountAmount: 1 }] } },
      { otherInvoices: [{ ...invoice, id: 43, totalAmount: -19.99 }] }, { outstanding: [{ invoiceNumber: "F00057", relationId: 5, mutationId: 91 }] }]) {
      assert.equal(preview(changes).status, "review_required");
    }
  });
  it("uses the original standard-VAT amounts without applying current KOR settings", () => {
    const standard = { ...invoice, totalAmount: 19.99, totalExcl: 16.52, vatAmount: 3.47, items: [{ ...payload.items[0], vatCode: "HOOG_VERK_21" }] };
    const result = preview({ invoice: standard });
    assert.equal(result.status, "missing_sales_posting");
    assert.equal(result.proposedMutation?.rows[0].vatCode, "HOOG_VERK_21");
  });
  it("explains a legacy document/schedule date discrepancy without proposing a date change", () => {
    const result = preview({ local: { ...local, invoiceDate: "2026-10-27" } });
    assert.equal(result.status, "review_required");
    assert.deepEqual(result.identityDifferences, [{ field: "date", expected: "2026-10-27", actual: "2026-11-01" }]);
    assert.equal(result.proposedMutation, null);
  });
});

describe("complete provider pagination", () => {
  it("does not mistake the per-page count for the total", async () => {
    const offsets: number[] = [];
    const rows = await pagination.readAllEboekhoudenPages(async (_limit, offset) => { offsets.push(offset); return { items: offset === 0 ? [{ id: 1 }, { id: 2 }] : [{ id: 3 }], count: offset === 0 ? 2 : 1 }; }, 2);
    assert.deepEqual(offsets, [0, 2]); assert.equal(rows.length, 3);
  });
  it("fails closed for missing lists, repeated pages and an exhausted scan cap", async () => {
    await assert.rejects(() => pagination.readAllEboekhoudenPages(async () => ({})), /no item list/);
    await assert.rejects(() => pagination.readAllEboekhoudenPages(async () => ({ items: [{ id: 1 }] }), 1), /repeated/);
    await assert.rejects(() => pagination.readAllEboekhoudenPages(async (_limit, offset) => ({ items: [{ id: offset + 1 }] }), 1, 2), /scan limit/);
  });
});
