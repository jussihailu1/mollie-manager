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

  it("only returns tenant-scoped ops snapshot when diagnostics tenant context is explicit", () => {
    const source = readFileSync(resolve("app/api/health/route.ts"), "utf8");

    assert.match(source, /function resolveRequestedTenantId\(request: Request\)/);
    assert.match(source, /searchParams\.get\("tenantId"\)\?\.trim\(\)/);
    assert.match(source, /tenantId: requestedTenantId/);
    assert.match(source, /const opsSnapshot = diagnosticsContext\.tenantId/);
    assert.match(
      source,
      /Pass \?tenantId=<tenant-id> to read tenant-scoped live readiness and reliability diagnostics\./,
    );
    assert.match(source, /invoiceAutomation: opsSnapshot\?\.invoiceAutomation \?\? null/);
    assert.match(source, /reliability: opsSnapshot\?\.reliability \?\? null/);
  });

  it("separates platform diagnostics from tenant live readiness", () => {
    const source = readFileSync(resolve("app/api/health/route.ts"), "utf8");

    assert.match(source, /const platform = getPlatformReadiness\(\)/);
    assert.match(source, /const tenant =\s+diagnosticsContext\.tenantId !== null/);
    assert.match(source, /const mode = diagnosticsContext\.tenantId \? "live" : resolveMode\(request\)/);
    assert.match(source, /platform,/);
    assert.match(source, /tenant,/);
    assert.doesNotMatch(source, /isMollieConfigured/);
    assert.doesNotMatch(source, /getSetupStatus\(\)/);
  });
});
