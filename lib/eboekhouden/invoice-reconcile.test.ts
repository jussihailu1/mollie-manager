import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { filterMatchingInvoicesByReference } from "@/lib/eboekhouden/invoice-reconcile-match";

describe("invoice reconcile match filter", () => {
  it("returns only exact reference+relation+date matches with id and number", () => {
    const input = {
      date: "2026-06-02",
      reference: "FP-12345678-260602",
      relationId: 1500,
    } as const;
    const matches = filterMatchingInvoicesByReference(
      [
        {
          date: "2026-06-02",
          id: 1,
          invoiceNumber: "F00037",
          reference: "FP-12345678-260602",
          relationId: 1500,
        },
        {
          date: "2026-06-02",
          id: 2,
          invoiceNumber: "F00038",
          reference: "FP-12345678-260602",
          relationId: 1400,
        },
        {
          date: "2026-06-02",
          id: 3,
          invoiceNumber: null,
          reference: "FP-12345678-260602",
          relationId: 1500,
        },
      ],
      input,
    );

    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.id, 1);
  });
});
