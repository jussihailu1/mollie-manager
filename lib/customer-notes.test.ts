import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeCustomerNoteBody } from "@/lib/customer-note-policy";

describe("customer notes helpers", () => {
  it("rejects blank notes", () => {
    assert.equal(normalizeCustomerNoteBody("  \n\t  "), null);
  });

  it("trims notes before storing", () => {
    assert.equal(normalizeCustomerNoteBody("  Call customer Monday.  "), "Call customer Monday.");
  });

  it("bounds stored note body length", () => {
    const body = normalizeCustomerNoteBody("x".repeat(2100));

    assert.equal(body?.length, 2000);
  });
});
