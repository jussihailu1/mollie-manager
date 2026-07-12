import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

function readRepoFile(filePath: string) {
  return readFileSync(resolve(filePath), "utf8");
}

describe("dashboard tenant wiring", () => {
  it("threads current tenant id through the normal dashboard pages and customer activity route", () => {
    const overview = readRepoFile("app/(dashboard)/page.tsx");
    const customers = readRepoFile("app/(dashboard)/customers/page.tsx");
    const payments = readRepoFile("app/(dashboard)/payments/page.tsx");
    const notifications = readRepoFile("app/(dashboard)/notifications/page.tsx");
    const settings = readRepoFile("app/(dashboard)/settings/page.tsx");
    const route = readRepoFile("app/api/customers/[customerId]/activity/route.ts");
    const layout = readRepoFile("app/(dashboard)/layout.tsx");

    for (const source of [overview, customers, payments, notifications, settings, route]) {
      assert.match(source, /getCurrentTenantSelectionForViewer/);
      assert.match(source, /tenantId/);
    }

    assert.match(overview, /tenantId = currentTenant\.id/);
    assert.match(customers, /tenantId = currentTenant\.id/);
    assert.match(payments, /tenantId = currentTenant\.id/);
    assert.match(notifications, /tenantId = currentTenant\.id/);
    assert.match(settings, /tenantId = tenantSelection\.currentTenant\.id/);
    assert.match(route, /tenantId = currentTenant\.id/);
    assert.match(layout, /tenantId: currentTenant\.id/);
  });
});
