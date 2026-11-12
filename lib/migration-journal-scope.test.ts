import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { describe, it } from "node:test";

type Journal = {
  entries: Array<{ idx: number; tag: string; when: number }>;
};

describe("Drizzle migration journal", () => {
  it("registers every SQL migration in deterministic order", () => {
    const journal = JSON.parse(
      readFileSync(resolve("db/drizzle/meta/_journal.json"), "utf8"),
    ) as Journal;
    const sqlTags = readdirSync(resolve("db/drizzle"))
      .filter((name) => /^\d{4}_.+\.sql$/.test(name))
      .map((name) => basename(name, ".sql"))
      .sort();
    const journalTags = journal.entries.map((entry) => entry.tag);

    assert.deepEqual(journalTags, sqlTags);
    journal.entries.forEach((entry, index) => {
      // Drizzle applies the ordered journal; reserved/deferred numbers may be
      // absent. Every entry must still match its file and increase monotonically.
      assert.equal(entry.idx, Number(entry.tag.slice(0, 4)));
      if (index > 0) {
        assert.ok(entry.idx > journal.entries[index - 1]!.idx);
        assert.ok(entry.when > journal.entries[index - 1]!.when);
      }
    });
  });
});
