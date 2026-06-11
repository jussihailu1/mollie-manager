import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildDeterministicMatchCte,
  buildFirstPaymentFilter,
} from "@/lib/eboekhouden/first-payment-invoice-match-query";

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

  return fragment.queryChunks
    .map(flattenChunk)
    .join("");
}

describe("first-payment invoice match query helpers", () => {
  it("builds the base first-payment filter", () => {
    const filter = inlineSql(buildFirstPaymentFilter());

    assert.match(filter, /p\.payment_type = 'first'/);
    assert.match(filter, /p\.mollie_payment_id is not null/);
  });

  it("adds mode and payment filters when provided", () => {
    const filter = inlineSql(
      buildFirstPaymentFilter({ mode: "live", paymentId: "payment_123" }),
    );

    assert.match(filter, /p\.mode = live/);
    assert.match(filter, /p\.id = payment_123/);
  });

  it("builds the deterministic match cte around the same filter", () => {
    const cte = inlineSql(buildDeterministicMatchCte({ mode: "test" }));

    assert.match(cte, /with payment_link_matches as/);
    assert.match(cte, /inner join subscription_onboarding_consents soc/);
    assert.match(cte, /where p\.payment_type = 'first'/);
    assert.match(cte, /p\.mode = test/);
  });
});
