import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("e-Boekhouden relation search tenant scope", () => {
  it("scopes linked relation exclusion to the active tenant", () => {
    const source = readFileSync(
      resolve("app/api/eboekhouden/relations/route.ts"),
      "utf8",
    );

    assert.match(source, /getCurrentTenantSelectionForViewer/);
    assert.match(
      source,
      /const \{ currentTenant \} = await getCurrentTenantSelectionForViewer\(\);/,
    );
    assert.match(source, /async function getLinkedRelationIds\(tenantId: string\)/);
    assert.match(source, /where tenant_id = \$\{tenantId\}/);
    assert.match(source, /getLinkedRelationIds\(currentTenant\.id\)/);
    assert.match(
      source,
      /searchEboekhoudenRelations\(\{[\s\S]*tenantId: currentTenant\.id,/,
    );
  });
});
