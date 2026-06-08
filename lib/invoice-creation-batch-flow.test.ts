import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createInvoiceBatchWithDependencies } from "@/lib/invoice-creation-batch";

describe("invoice creation batch flow", () => {
  it("maps first-payment creation candidates into invoice creation attempts", async () => {
    const created: string[] = [];

    const result = await createInvoiceBatchWithDependencies(
      {
        actor: { kind: "system" },
        limit: 10,
        mode: "test",
      },
      {
        createInvoice: async (entityId) => {
          created.push(entityId);

          if (entityId === "payment_created") {
            return { status: "created" as const };
          }

          if (entityId === "payment_failed") {
            return { status: "failed" as const };
          }

          return { status: "skipped" as const };
        },
        getRemainingSummary: async () => ({
          actionableCount: 1,
        }),
        loadCandidates: async () => [
          { entityId: "payment_created" },
          { entityId: "payment_failed" },
          { entityId: "payment_skipped" },
        ],
      },
    );

    assert.deepEqual(created, [
      "payment_created",
      "payment_failed",
      "payment_skipped",
    ]);
    assert.deepEqual(result, {
      actionableCount: 3,
      createdCount: 1,
      failedCount: 1,
      remainingActionableCount: 1,
      skippedCount: 1,
    });
  });

  it("maps recurring creation candidates into invoice creation attempts", async () => {
    const created: string[] = [];

    const result = await createInvoiceBatchWithDependencies(
      {
        actor: { kind: "user" },
        limit: 10,
        mode: "live",
      },
      {
        createInvoice: async (entityId) => {
          created.push(entityId);

          if (entityId === "schedule_created") {
            return { status: "created" as const };
          }

          return { status: "skipped" as const };
        },
        getRemainingSummary: async () => ({
          actionableCount: 2,
        }),
        loadCandidates: async () => [
          { entityId: "schedule_created" },
          { entityId: "schedule_skipped" },
        ],
      },
    );

    assert.deepEqual(created, ["schedule_created", "schedule_skipped"]);
    assert.deepEqual(result, {
      actionableCount: 2,
      createdCount: 1,
      failedCount: 0,
      remainingActionableCount: 2,
      skippedCount: 1,
    });
  });
});
