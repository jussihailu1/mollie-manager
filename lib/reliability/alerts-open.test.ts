import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
// @ts-expect-error The test runtime is Node 22, newer than the project's Node typings.
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import type { DbClient } from "@/lib/db";

type ResolveHook = (
  specifier: string,
  context: unknown,
  nextResolve: (specifier: string, context: unknown) => unknown,
) => unknown;

const emptyServerOnlyModule = pathToFileURL(
  resolve("node_modules/next/dist/compiled/server-only/empty.js"),
).href;

registerHooks({
  resolve: ((specifier, context, nextResolve) => {
    if (specifier === "server-only") {
      return {
        shortCircuit: true,
        url: emptyServerOnlyModule,
      };
    }

    return nextResolve(specifier, context);
  }) satisfies ResolveHook,
});

let alertsModule: Promise<typeof import("@/lib/reliability/alerts")> | undefined;

async function getOpenAlert() {
  alertsModule ??= import("@/lib/reliability/alerts");
  return (await alertsModule).openAlert;
}

async function getResolveAlertsForEntity() {
  alertsModule ??= import("@/lib/reliability/alerts");
  return (await alertsModule).resolveAlertsForEntity;
}

type AlertRow = { id: string };

function createClient(scriptedRows: AlertRow[][]) {
  const queries: string[] = [];
  const dialect = new PgDialect();

  const client = {
    execute: async (query: SQL) => {
      queries.push(dialect.sqlToQuery(query).sql);
      return {
        rows: scriptedRows.shift() ?? [],
      };
    },
  } as unknown as DbClient;

  return { client, queries };
}

const alertInput = {
  customerId: "customer_1",
  message: "Payment processing needs operator review.",
  paymentId: "payment_1",
  payload: { internalReason: "processor_failure" },
  severity: "warning" as const,
  subscriptionId: "subscription_1",
  tenantId: "tenant_1",
  title: "Payment needs review",
};

describe("openAlert unresolved alert uniqueness", () => {
  it("returns the atomic insert result as a new alert", async () => {
    const openAlert = await getOpenAlert();
    const { client, queries } = createClient([[{ id: "alert_created" }]]);

    const result = await openAlert(alertInput, client);

    assert.deepEqual(result, { id: "alert_created", isNew: true });
    assert.deepEqual(Object.keys(result).sort(), ["id", "isNew"]);
    assert.equal(queries.length, 1);
    assert.match(queries[0] ?? "", /on conflict do nothing\s+returning id/i);
  });

  it("returns an existing open or acknowledged conflict winner", async () => {
    const openAlert = await getOpenAlert();
    const { client, queries } = createClient([
      [],
      [{ id: "alert_acknowledged" }],
    ]);

    const result = await openAlert(alertInput, client);

    assert.deepEqual(result, { id: "alert_acknowledged", isNew: false });
    assert.equal(queries.length, 2);
    assert.match(queries[1] ?? "", /status in \('open', 'acknowledged'\)/i);
    assert.match(queries[1] ?? "", /coalesce\(alert\.customer_id, ''\)/i);
    assert.match(queries[1] ?? "", /coalesce\(alert\.payment_id, ''\)/i);
    assert.match(queries[1] ?? "", /coalesce\(alert\.subscription_id, ''\)/i);
    assert.match(queries[1] ?? "", /payload ->> 'tenantId'/i);
  });

  it("retries when the conflict winner resolves before it can be fetched", async () => {
    const openAlert = await getOpenAlert();
    const { client, queries } = createClient([
      [],
      [],
      [{ id: "alert_after_resolution" }],
    ]);

    const result = await openAlert(alertInput, client);

    assert.deepEqual(result, { id: "alert_after_resolution", isNew: true });
    assert.equal(queries.length, 3);
    assert.match(queries[2] ?? "", /^\s*insert into alerts/i);
  });

  it("keeps null entity IDs coalesced without adding customer identity", async () => {
    const openAlert = await getOpenAlert();
    const { client, queries } = createClient([[], [{ id: "system_alert" }]]);

    const result = await openAlert(
      {
        ...alertInput,
        customerId: null,
        paymentId: null,
        subscriptionId: null,
      },
      client,
    );

    assert.deepEqual(result, { id: "system_alert", isNew: false });
    assert.match(queries[1] ?? "", /coalesce\(\$\d+, ''\)/i);
    assert.match(queries[1] ?? "", /customer_id/i);
    assert.match(queries[1] ?? "", /payload ->> 'tenantId'/i);
  });
});

describe("resolveAlertsForEntity tenant scope", () => {
  it("requires tenant-fenced alert resolution queries", async () => {
    const resolveAlertsForEntity = await getResolveAlertsForEntity();
    const { client, queries } = createClient([[]]);

    await resolveAlertsForEntity(
      {
        paymentId: "payment_1",
        subscriptionId: "subscription_1",
        tenantId: "tenant_1",
      },
      client,
    );

    assert.equal(queries.length, 1);
    assert.match(queries[0] ?? "", /update alerts as alert/i);
    assert.match(queries[0] ?? "", /payload ->> 'tenantId'/i);
    assert.match(queries[0] ?? "", /from payments p/i);
    assert.match(queries[0] ?? "", /from subscriptions s/i);
    assert.match(queries[0] ?? "", /from customers c/i);
  });
});

describe("unresolved alert uniqueness migrations", () => {
  for (const migrationPath of [
    "db/migrations/0014_unresolved_alert_uniqueness.sql",
    "db/drizzle/0013_unresolved_alert_uniqueness.sql",
  ]) {
    it(`resolves deterministic duplicates before indexing in ${migrationPath}`, () => {
      const migration = readFileSync(migrationPath, "utf8");

      assert.match(migration, /row_number\(\) over/i);
      assert.match(migration, /partition by[\s\S]*title[\s\S]*coalesce\([^)]*payment_id[^)]*, ''\)[\s\S]*coalesce\([^)]*subscription_id[^)]*, ''\)/i);
      assert.match(migration, /order by[^;]*created_at[^;]*id/i);
      assert.match(migration, /set[\s\S]*status[^=]*= 'resolved'/i);
      assert.doesNotMatch(migration, /delete\s+from/i);
      assert.match(migration, /create unique index[\s\S]*alerts_unresolved_title_entity_key/i);
      assert.match(migration, /where[^;]*status[^;]*in \('open', 'acknowledged'\)/i);
      assert.ok(
        migration.search(/status[^=]*= 'resolved'/i) <
          migration.search(/create unique index/i),
      );
    });
  }

  for (const migrationPath of [
    "db/migrations/0019_alert_tenant_scope.sql",
    "db/drizzle/0018_alert_tenant_scope.sql",
  ]) {
    it(`adds tenant-aware unresolved uniqueness in ${migrationPath}`, () => {
      const migration = readFileSync(migrationPath, "utf8");

      assert.match(migration, /drop index if exists/i);
      assert.match(migration, /customer_id/i);
      assert.match(migration, /payload[^;]*tenantId/i);
      assert.match(migration, /alerts_unresolved_title_entity_tenant_key/i);
    });
  }
});
