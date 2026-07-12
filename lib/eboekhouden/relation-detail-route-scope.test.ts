import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("e-Boekhouden relation detail route scope", () => {
  it("requires active tenant context before loading a relation", () => {
    const source = readFileSync("app/api/eboekhouden/relations/[id]/route.ts", "utf8");

    assert.match(source, /getCurrentTenantSelectionForViewer/);
    assert.doesNotMatch(source, /requireViewerSession/);
    assert.match(source, /const \{ currentTenant \} = await getCurrentTenantSelectionForViewer\(\);/);
    assert.match(source, /const \{ id \} = await params;/);
    assert.match(
      source,
      /const relation = await getEboekhoudenRelation\(relationId, currentTenant\.id\);/,
    );
  });
});
