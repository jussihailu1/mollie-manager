import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("recurring invoice candidate scope", () => {
  it("includes tenant id in recurring schedule candidates", () => {
    const source = readFileSync("lib/eboekhouden/recurring-invoice-candidate.ts", "utf8");

    assert.match(source, /tenantId: string/);
    assert.match(source, /rbs\.tenant_id as "tenantId"/);
    assert.match(source, /and s\.tenant_id = rbs\.tenant_id/);
    assert.match(source, /and c\.tenant_id = rbs\.tenant_id/);
    assert.match(source, /where rbs\.id = \$\{scheduleId\}[\s\S]*and rbs\.tenant_id = \$\{tenantId\}/);
  });
});
