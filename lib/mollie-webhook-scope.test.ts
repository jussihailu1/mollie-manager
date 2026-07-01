import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("mollie webhook scope", () => {
  it("keeps generated webhook urls free of shared secrets", () => {
    const source = readFileSync(resolve("lib/mollie/client.ts"), "utf8");

    assert.match(source, /new URL\(path, config\.MOLLIE_WEBHOOK_PUBLIC_BASE_URL\)\.toString\(\)/);
    assert.doesNotMatch(source, /searchParams\.set\("secret"/);
  });

  it("does not gate webhook intake on a query-string secret", () => {
    const source = readFileSync(resolve("app/api/webhooks/mollie/route.ts"), "utf8");

    assert.doesNotMatch(source, /searchParams\.get\("secret"\)/);
    assert.doesNotMatch(source, /MOLLIE_WEBHOOK_SHARED_SECRET/);
  });

  it("requires webhook resources to resolve to managed local state", () => {
    const routeSource = readFileSync(resolve("app/api/webhooks/mollie/route.ts"), "utf8");
    const processingSource = readFileSync(
      resolve("lib/reliability/webhook-processing.ts"),
      "utf8",
    );
    const syncSource = readFileSync(resolve("lib/reliability/sync.ts"), "utf8");

    assert.match(routeSource, /handleMollieWebhookRequest/);
    assert.match(processingSource, /supportedWebhookResourceIdPattern/);
    assert.match(routeSource, /findExistingResourceContext/);
    assert.match(routeSource, /tenant_id as "tenantId"/);
    assert.match(routeSource, /insert into webhook_events \([\s\S]*tenant_id/);
    assert.match(processingSource, /tenantId: existingResourceContext\?\.tenantId \?\? null/);
    assert.match(routeSource, /requireManagedResource: true/);
    assert.match(syncSource, /Payment webhook is not linked to a managed local resource\./);
    assert.match(syncSource, /Payment-link webhook is not linked to a managed local resource\./);
  });
});
