import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildCanonicalKifyInvoice,
  calculateVatInclusiveLine,
} from "@/lib/invoicing/canonical-invoice";

describe("canonical Kify invoice money", () => {
  it("uses integer-cent VAT-inclusive half-up math and preserves gross total", () => {
    assert.deepEqual(calculateVatInclusiveLine(121), {
      grossCents: 121,
      netCents: 100,
      vatCents: 21,
    });

    const invoice = buildCanonicalKifyInvoice({
      lines: [{ currency: "EUR", description: "Abonnement", grossCents: 12101, quantity: 1, vatRateBasisPoints: 2100 }],
      sourceAmountCents: 12101,
    });

    assert.equal(invoice.totalCents, 12101);
    assert.equal(invoice.subtotalCents + invoice.vatCents, invoice.totalCents);
  });

  it("rejects unsupported or inconsistent amounts before any number allocation", () => {
    assert.throws(() => buildCanonicalKifyInvoice({
      lines: [{ currency: "USD", description: "Abonnement", grossCents: 100, quantity: 1, vatRateBasisPoints: 2100 }],
      sourceAmountCents: 100,
    }), /EUR/);
    assert.throws(() => buildCanonicalKifyInvoice({
      lines: [{ currency: "EUR", description: "Abonnement", grossCents: 100, quantity: 1, vatRateBasisPoints: 900 }],
      sourceAmountCents: 100,
    }), /21% VAT/);
    assert.throws(() => buildCanonicalKifyInvoice({
      lines: [{ currency: "EUR", description: "Abonnement", grossCents: 100, quantity: 1, vatRateBasisPoints: 2100 }],
      sourceAmountCents: 101,
    }), /exactly equal/);
  });
});
