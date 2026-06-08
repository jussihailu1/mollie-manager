import type { MollieMode } from "@/lib/env";
import type { InvoiceActor } from "@/lib/invoice-delivery-batch";

export type InvoiceCreationBatchCandidate = {
  entityId: string;
};

export type InvoiceCreationBatchResult = {
  actionableCount: number;
  createdCount: number;
  failedCount: number;
  remainingActionableCount: number;
  skippedCount: number;
};

export type InvoiceCreationBatchDependencies = {
  createInvoice: (
    entityId: string,
  ) => Promise<{ status: "created" | "failed" | "skipped" }>;
  getRemainingSummary: (mode: MollieMode) => Promise<{ actionableCount: number }>;
  loadCandidates: (
    mode: MollieMode,
    limit: number,
  ) => Promise<InvoiceCreationBatchCandidate[]>;
};

export async function createInvoiceBatchWithDependencies(
  input: {
    actor: InvoiceActor;
    limit?: number;
    mode: MollieMode;
  },
  dependencies: InvoiceCreationBatchDependencies,
) {
  const candidates = await dependencies.loadCandidates(
    input.mode,
    input.limit ?? 25,
  );
  let createdCount = 0;
  let failedCount = 0;
  let skippedCount = 0;

  for (const candidate of candidates) {
    const result = await dependencies.createInvoice(candidate.entityId);

    if (result.status === "created") {
      createdCount += 1;
      continue;
    }

    if (result.status === "failed") {
      failedCount += 1;
      continue;
    }

    skippedCount += 1;
  }

  const remainingSummary = await dependencies.getRemainingSummary(input.mode);

  return {
    actionableCount: candidates.length,
    createdCount,
    failedCount,
    remainingActionableCount: remainingSummary.actionableCount,
    skippedCount,
  } satisfies InvoiceCreationBatchResult;
}
