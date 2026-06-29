import type { MollieMode } from "@/lib/env";

export type InvoiceActor = {
  email?: string | null;
  kind: "system" | "user";
};

export type DeliveryInput = {
  actor: InvoiceActor;
  customerEmail: string | null;
  customerId: string | null;
  eboekhoudenInvoiceId: string | null;
  eboekhoudenInvoiceNumber: string | null;
  eboekhoudenInvoicePdfUrl?: string | null;
  entityId: string;
  invoiceType: "first_payment" | "recurring";
  mode: MollieMode;
  plannedCollectionDate?: string | null;
  subscriptionId: string | null;
  tenantId: string;
};

export type RetryDeliveryCandidate = Omit<DeliveryInput, "actor">;

export type InvoiceDeliveryBatchResult = {
  attemptedCount: number;
  failedCount: number;
  sentCount: number;
  skippedCount: number;
};

export type RetryInvoiceDeliveryBatchDependencies = {
  deliverCustomerInvoiceEmail: (
    input: DeliveryInput,
  ) => Promise<{ status: "failed" | "sent" | "skipped" }>;
  loadCandidates: (
    mode: MollieMode,
    limit: number,
    tenantId: string,
  ) => Promise<RetryDeliveryCandidate[]>;
};

export async function retryInvoiceDeliveryEmailsBatchWithDependencies(
  input: {
    actor: InvoiceActor;
    limit?: number;
    mode: MollieMode;
    tenantId: string;
  },
  dependencies: RetryInvoiceDeliveryBatchDependencies,
) {
  const candidates = await dependencies.loadCandidates(
    input.mode,
    input.limit ?? 25,
    input.tenantId,
  );
  let sentCount = 0;
  let failedCount = 0;
  let skippedCount = 0;

  for (const candidate of candidates) {
    const result = await dependencies.deliverCustomerInvoiceEmail({
      actor: input.actor,
      ...candidate,
    });

    if (result.status === "sent") {
      sentCount += 1;
      continue;
    }

    if (result.status === "failed") {
      failedCount += 1;
      continue;
    }

    skippedCount += 1;
  }

  return {
    attemptedCount: candidates.length,
    failedCount,
    sentCount,
    skippedCount,
  } satisfies InvoiceDeliveryBatchResult;
}
