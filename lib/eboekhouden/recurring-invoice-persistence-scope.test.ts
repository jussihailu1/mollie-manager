import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("recurring invoice persistence scope", () => {
  it("threads tenant id into recurring invoice alert delivery", () => {
    const source = readFileSync("lib/eboekhouden/recurring-invoice-persistence.ts", "utf8");

    assert.match(source, /tenantId: string/);
    assert.match(source, /tenantId: input\.candidate\.tenantId/);
  });
});
