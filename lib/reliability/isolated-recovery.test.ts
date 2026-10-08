import assert from "node:assert/strict";
import { it } from "node:test";
import { recoverTargetsIndependently } from "./isolated-recovery";

it("an archived or unavailable record cannot abort recovery of later payments", async () => {
  const attempted: string[] = [];
  const failed: string[] = [];
  const result = await recoverTargetsIndependently(["archived", "unavailable", "september", "unlinked"], async (id) => {
    attempted.push(id);
    if (id === "archived") throw new Error("Subscription activation is not ready: archived");
    if (id === "unavailable") throw new Error("Provider temporarily unavailable");
    return id === "unlinked" ? "skipped" : "repaired";
  }, async (id) => { failed.push(id); });
  assert.deepEqual(attempted, ["archived", "unavailable", "september", "unlinked"]);
  assert.deepEqual(failed, ["archived", "unavailable"]);
  assert.deepEqual(result, { repairedCount: 1, skippedCount: 3, failedCount: 2 });
});

it("keeps later targets isolated when failure reporting also fails", async () => {
  const result = await recoverTargetsIndependently([1, 2], async (id) => {
    if (id === 1) throw new Error("provider unavailable");
    return "repaired";
  }, async () => { throw new Error("audit unavailable"); });
  assert.deepEqual(result, { repairedCount: 1, skippedCount: 1, failedCount: 1 });
});
