import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("health route scope", () => {
  it("keeps diagnostics behind advanced operator or bearer authorization", () => {
    const source = readFileSync(resolve("app/api/health/route.ts"), "utf8");

    assert.match(source, /resolveDiagnosticsContext/);
    assert.match(source, /getViewerSession/);
    assert.match(source, /hasAdvancedOperationsAccess/);
    assert.match(source, /getCurrentTenantSelectionForViewer/);
    assert.match(source, /const diagnosticsContext = await resolveDiagnosticsContext\(request\)/);
    assert.match(source, /if \(!diagnosticsContext\.authorized\)/);
  });

  it("keeps the public response minimal", () => {
    const source = readFileSync(resolve("app/api/health/route.ts"), "utf8");

    assert.match(
      source,
      /if \(!diagnosticsContext\.authorized\) \{\s*return Response\.json\(\{\s*app: "Kify",\s*status: "ok",\s*timestamp:/,
    );
  });
});
