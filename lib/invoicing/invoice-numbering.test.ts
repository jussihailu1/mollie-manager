import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import { formatKifyInvoiceNumber } from "@/lib/invoicing/invoice-number-format";

describe("Kify invoice numbering", () => {
  it("keeps test and live sequences visibly separate", () => {
    assert.equal(formatKifyInvoiceNumber({ mode: "live", prefix: "KFY", sequence: 1, year: 2026 }), "KFY-2026-000001");
    assert.equal(formatKifyInvoiceNumber({ mode: "test", prefix: "KFY", sequence: 1, year: 2026 }), "TEST-KFY-2026-000001");
  });

  it("rejects unsafe sequence inputs", () => {
    assert.throws(() => formatKifyInvoiceNumber({ mode: "live", prefix: "kfy", sequence: 1, year: 2026 }), /uppercase/);
    assert.throws(() => formatKifyInvoiceNumber({ mode: "live", prefix: "KFY", sequence: 0, year: 2026 }), /sequence/);
  });

  it("allocates through one tenant-scoped atomic upsert", () => {
    const source = readFileSync(resolve("lib/invoicing/invoice-numbering.ts"), "utf8");
    assert.match(source, /on conflict \(tenant_id, mode, year, prefix\)/i);
    assert.match(source, /next_value = tenant_invoice_sequences\.next_value \+ 1/i);
    assert.match(source, /returning next_value - 1/i);
  });
});
