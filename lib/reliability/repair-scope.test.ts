import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("repair surface scope", () => {
  it("surfaces a targeted repair form in settings", () => {
    const source = readFileSync(resolve("app/(dashboard)/settings/page.tsx"), "utf8");

    assert.match(source, /Targeted repair/);
    assert.match(source, /repairReliabilityTargetAction/);
    assert.match(source, /repairTargetKind/);
    assert.match(source, /repairTargetId/);
    assert.match(source, /Repair the selected target now\?/);
  });

  it("routes API and server actions through the shared repair helper", () => {
    const actionSource = readFileSync(resolve("lib/reliability/actions.ts"), "utf8");
    const routeSource = readFileSync(
      resolve("app/api/reliability/repair/route.ts"),
      "utf8",
    );
    const helperSource = readFileSync(resolve("lib/reliability/repair.ts"), "utf8");

    assert.match(actionSource, /repairReliabilityTargetAction/);
    assert.match(actionSource, /repairReliabilityTarget/);
    assert.match(actionSource, /getCurrentTenantSelectionForViewer/);
    assert.match(routeSource, /repairReliabilityTarget/);
    assert.match(routeSource, /getCurrentTenantSelectionForViewer/);
    assert.match(routeSource, /tenantId: tenantSelection\.currentTenant\.id/);
    assert.match(helperSource, /export async function repairReliabilityTarget/);
    assert.match(helperSource, /tenantId\?: string/);
    assert.match(helperSource, /alert_customer\.tenant_id = \$\{tenantId\}/);
    assert.match(helperSource, /alert_payment\.tenant_id = \$\{tenantId\}/);
    assert.match(helperSource, /alert_subscription\.tenant_id = \$\{tenantId\}/);
  });

  it("requires advanced access for repair API calls", () => {
    const routeSource = readFileSync(
      resolve("app/api/reliability/repair/route.ts"),
      "utf8",
    );

    assert.match(routeSource, /hasAdvancedOperationsAccess/);
    assert.match(routeSource, /Advanced operations access is required\./);
    assert.match(routeSource, /status: 403/);
  });
});
