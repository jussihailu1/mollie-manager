import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildRecurringDueInvoiceFilter,
  buildRecurringFailedInvoiceFilter,
} from "@/lib/eboekhouden/recurring-invoice-query";

function inlineSql(fragment: { queryChunks: unknown[] }) {
  function flattenChunk(chunk: unknown): string {
    if (
      typeof chunk === "string" ||
      typeof chunk === "number" ||
      typeof chunk === "boolean"
    ) {
      return String(chunk);
    }

    if (chunk && typeof chunk === "object") {
      if ("value" in chunk && Array.isArray((chunk as { value: unknown[] }).value)) {
        return (chunk as { value: unknown[] }).value.map(flattenChunk).join("");
      }

      if (
        "queryChunks" in chunk &&
        Array.isArray((chunk as { queryChunks: unknown[] }).queryChunks)
      ) {
        return (chunk as { queryChunks: unknown[] }).queryChunks.map(flattenChunk).join("");
      }
    }

    return String(chunk);
  }

  return fragment.queryChunks.map(flattenChunk).join("");
}

describe("recurring invoice query helpers", () => {
  it("builds the recurring due filter", () => {
    const filter = inlineSql(buildRecurringDueInvoiceFilter("live"));

    assert.match(filter, /rbs\.mode = live/);
    assert.match(filter, /rbs\.invoice_state = pending_invoice/);
    assert.match(filter, /rbs\.invoice_send_due_date <= current_date/);
    assert.match(filter, /from invoices i/);
    assert.match(filter, /i\.owner_type = 'recurring_schedule'/);
  });

  it("builds the recurring failed filter", () => {
    const filter = inlineSql(buildRecurringFailedInvoiceFilter("test"));

    assert.match(filter, /rbs\.mode = test/);
    assert.match(filter, /rbs\.invoice_state = invoice_failed/);
    assert.match(filter, /from invoices i/);
    assert.match(filter, /i\.owner_id = rbs\.id/);
  });
});
