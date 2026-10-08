import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { eboekhoudenTaxFields, requireTaxTreatment } from "@/lib/invoicing/tax-treatment";

describe("invoice tax treatment", () => {
  it("requires an explicit status and maps KOR to no VAT", () => {
    assert.throws(() => requireTaxTreatment(null), /Select whether/);
    assert.deepEqual(eboekhoudenTaxFields("kor"), {
      inExVat: "IN",
      vatCode: "GEEN",
      text: "Factuur vrijgesteld van omzetbelasting op grond van de kleineondernemersregeling (KOR).",
    });
    assert.equal(eboekhoudenTaxFields("standard").vatCode, "HOOG_VERK_21");
  });
});
