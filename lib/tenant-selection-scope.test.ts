import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("tenant selection wiring", () => {
  it("threads active tenant selection through layout, shell, and server action", () => {
    const tenantsSource = readFileSync(resolve("lib/tenants.ts"), "utf8");
    const tenantContextSource = readFileSync(
      resolve("lib/tenant-context.ts"),
      "utf8",
    );
    const actionSource = readFileSync(
      resolve("lib/tenant-selection-actions.ts"),
      "utf8",
    );
    const layoutSource = readFileSync(
      resolve("app/(dashboard)/layout.tsx"),
      "utf8",
    );
    const shellSource = readFileSync(
      resolve("components/operations-shell.tsx"),
      "utf8",
    );

    assert.match(tenantsSource, /export async function getAccessibleTenantsForOperatorEmail/);
    assert.match(tenantsSource, /export async function resolveTenantSelectionForOperatorEmail/);
    assert.match(tenantsSource, /resolveTenantSelectionId/);
    assert.match(actionSource, /tenantSelectionCookieName/);
    assert.match(actionSource, /setSelectedTenantAction/);
    assert.match(actionSource, /revalidatePath/);
    assert.match(actionSource, /redirect/);
    assert.match(tenantContextSource, /tenantSelectionCookieName/);
    assert.match(tenantContextSource, /resolveTenantSelectionForOperatorEmail/);
    assert.match(layoutSource, /getCurrentTenantSelectionForViewer/);
    assert.match(layoutSource, /accessibleTenants/);
    assert.match(layoutSource, /currentTenant/);
    assert.match(shellSource, /accessibleTenants/);
    assert.match(shellSource, /currentTenant/);
    assert.match(shellSource, /setSelectedTenantAction/);
  });
});
