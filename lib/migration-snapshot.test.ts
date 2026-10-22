import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { generateDrizzleJson } from "drizzle-kit/api";
import * as schema from "../db/schema";

type Snapshot = ReturnType<typeof generateDrizzleJson>;
const meta = resolve("db/drizzle/meta");
function readSnapshot(name: string): Snapshot {
  return JSON.parse(readFileSync(resolve(meta, name), "utf8")) as Snapshot;
}
function schemaBody(snapshot: Snapshot) {
  // Match Drizzle's JSON serialization: optional undefined fields are omitted.
  return JSON.parse(JSON.stringify(Object.fromEntries(
    Object.entries(snapshot).filter(([key]) => key !== "id" && key !== "prevId"),
  ))) as Record<string, unknown>;
}

// Pure schema serialization: no application config, .env loading, SQL execution
// or database connection. Unlike `drizzle-kit check`, this detects schema drift.
describe("Drizzle snapshot history", () => {
  it("links existing checkpoints and covers the latest journal entry", () => {
    const names = readdirSync(meta).filter((name) => /^\d{4}_snapshot\.json$/.test(name)).sort();
    const journal = JSON.parse(readFileSync(resolve(meta, "_journal.json"), "utf8")) as {
      entries: Array<{ idx: number }>;
    };
    const indices = new Set(journal.entries.map((entry) => entry.idx));
    const ids = new Set<string>();
    let previousId = "00000000-0000-0000-0000-000000000000";
    for (const name of names) {
      const snapshot = readSnapshot(name);
      assert.ok(indices.has(Number(name.slice(0, 4))), `${name} lacks a journal entry`);
      assert.equal(snapshot.prevId, previousId, `${name} breaks the snapshot chain`);
      assert.ok(!ids.has(snapshot.id), `${name} reuses a snapshot ID`);
      ids.add(snapshot.id);
      previousId = snapshot.id;
    }
    assert.equal(Number(names.at(-1)!.slice(0, 4)), journal.entries.at(-1)!.idx);
  });

  it("matches the current schema without needing a duplicate migration", () => {
    const names = readdirSync(meta).filter((name) => /^\d{4}_snapshot\.json$/.test(name)).sort();
    const latest = readSnapshot(names.at(-1)!);
    assert.ok(isDeepStrictEqual(schemaBody(latest), schemaBody(generateDrizzleJson(schema))),
      "Schema and latest snapshot differ. Generate/reconcile migration metadata before continuing.");
  });

  it("records only the activation tables at 0027", () => {
    const before = readSnapshot("0026_snapshot.json");
    const after = readSnapshot("0027_snapshot.json");
    for (const table of ["public.subscription_activation_jobs", "public.subscription_activation_notifications"]) {
      assert.equal(before.tables[table], undefined);
      assert.ok(after.tables[table]);
      delete after.tables[table];
    }
    assert.deepEqual(schemaBody(after), schemaBody(before));
  });

  it("records only nullable webhook mode at 0028; the data correction stays in SQL", () => {
    const before = readSnapshot("0027_snapshot.json");
    const after = readSnapshot("0028_snapshot.json");
    assert.equal(before.tables["public.webhook_events"].columns.mode.notNull, true);
    assert.equal(after.tables["public.webhook_events"].columns.mode.notNull, false);
    after.tables["public.webhook_events"].columns.mode.notNull = true;
    assert.deepEqual(schemaBody(after), schemaBody(before));
  });

  it("records nullable tax treatment and the existing check constraint at 0029", () => {
    const before = readSnapshot("0028_snapshot.json");
    const after = readSnapshot("0029_snapshot.json");
    const table = after.tables["public.tenant_billing_settings"];
    assert.equal(table.columns.tax_treatment.notNull, false);
    assert.equal(table.checkConstraints.tenant_billing_settings_tax_treatment_check.value,
      '"tenant_billing_settings"."tax_treatment" in (\'kor\', \'standard\')');
    delete table.columns.tax_treatment;
    delete table.checkConstraints.tenant_billing_settings_tax_treatment_check;
    assert.deepEqual(schemaBody(after), schemaBody(before));
  });
});
