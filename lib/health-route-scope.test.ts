import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("health route scope", () => {
  it("keeps diagnostics behind bearer authorization", () => {
    const source = readFileSync(resolve("app/api/health/route.ts"), "utf8");

    assert.match(source, /isDiagnosticsAuthorized/);
    assert.match(source, /if \(!isDiagnosticsAuthorized\(request\)\)/);
  });

  it("keeps the public response minimal", () => {
    const source = readFileSync(resolve("app/api/health/route.ts"), "utf8");

    assert.match(
      source,
      /if \(!isDiagnosticsAuthorized\(request\)\) \{\s*return Response\.json\(\{\s*app: "Kify",\s*status: "ok",\s*timestamp:/,
    );
  });
});
