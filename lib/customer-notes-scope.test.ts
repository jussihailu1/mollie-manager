import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("customer notes source", () => {
  it("models notes in an explicit table with typed source and legacy backfill", () => {
    const schemaSource = readFileSync(resolve("db/schema.ts"), "utf8");
    const migrationSource = readFileSync(
      resolve("db/migrations/0012_customer_notes.sql"),
      "utf8",
    );

    assert.match(schemaSource, /customerNoteSourceEnum/);
    assert.match(schemaSource, /export const customerNotes = pgTable/);
    assert.match(schemaSource, /customer_notes_body_not_blank_check/);
    assert.match(migrationSource, /CREATE TABLE customer_notes/);
    assert.match(migrationSource, /legacy-customer-note:/);
    assert.match(migrationSource, /btrim\(c\.notes\)/);
  });

  it("keeps note reads separate from audit logs and legacy customer columns", () => {
    const source = readFileSync(resolve("lib/customer-notes.ts"), "utf8");

    assert.match(source, /from customer_notes cn/);
    assert.doesNotMatch(source, /audit_logs/);
    assert.doesNotMatch(source, /customers\.notes|c\.notes/);
  });

  it("adds notes to the sanitized customer activity timeline as stable items", () => {
    const source = readFileSync(resolve("lib/customer-activity-timeline.ts"), "utf8");

    assert.match(source, /"customer_note"/);
    assert.match(source, /from customer_notes cn/);
    assert.match(source, /left\(cn\.body, 177\)/);
  });
});
