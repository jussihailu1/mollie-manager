import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("tenant access gate", () => {
  it("checks tenant membership or bootstrap operator access before dashboard entry", () => {
    const tenantsSource = readFileSync(resolve("lib/tenants.ts"), "utf8");
    const tenantContextSource = readFileSync(
      resolve("lib/tenant-context.ts"),
      "utf8",
    );
    const layoutSource = readFileSync(
      resolve("app/(dashboard)/layout.tsx"),
      "utf8",
    );

    assert.match(tenantsSource, /operator_tenant_memberships/);
    assert.match(tenantsSource, /platform_operators/);
    assert.match(tenantsSource, /export async function getTenantAccessForOperatorEmail/);
    assert.match(tenantsSource, /export async function requireTenantAccessForOperatorEmail/);
    assert.match(tenantContextSource, /requireTenantAccessForOperatorEmail\(session\.user\.email\)/);
    assert.match(tenantContextSource, /redirect\("\/login\?error=AccessDenied"\)/);
    assert.match(layoutSource, /getCurrentTenantSelectionForViewer/);
  });
});
