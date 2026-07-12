import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  retryInvoiceDeliveryEmailsBatchWithDependencies,
} from "@/lib/invoice-delivery-batch";

describe("invoice delivery retry flow", () => {
  it("maps first-payment retry candidates into delivery attempts", async () => {
    const delivered: Array<{
      entityId: string;
      invoiceType: "first_payment" | "recurring";
      plannedCollectionDate?: string | null;
    }> = [];

    const result = await retryInvoiceDeliveryEmailsBatchWithDependencies(
      {
        actor: { kind: "system" },
        limit: 10,
        mode: "test",
        tenantId: "tenant_1",
      },
      {
        deliverCustomerInvoiceEmail: async (input) => {
          delivered.push({
            entityId: input.entityId,
            invoiceType: input.invoiceType,
            plannedCollectionDate: input.plannedCollectionDate ?? null,
          });

          if (input.entityId === "payment_sent") {
            return { status: "sent" as const };
          }

          if (input.entityId === "payment_failed") {
            return { status: "failed" as const };
          }

          return { status: "skipped" as const };
        },
        loadCandidates: async (_mode, _limit, tenantId) => {
          assert.equal(tenantId, "tenant_1");
          return [
          {
            customerEmail: "ops@example.com",
            customerId: "customer_1",
            entityId: "payment_sent",
            invoiceDocumentUrl: null,
            invoiceId: "123",
            invoiceNumber: "INV-123",
            invoiceProvider: "eboekhouden",
            invoiceType: "first_payment",
            mode: "test",
            plannedCollectionDate: null,
            subscriptionId: "subscription_1",
            tenantId: "tenant_1",
          },
          {
            customerEmail: "ops@example.com",
            customerId: "customer_1",
            entityId: "payment_failed",
            invoiceDocumentUrl: null,
            invoiceId: "124",
            invoiceNumber: "INV-124",
            invoiceProvider: "eboekhouden",
            invoiceType: "first_payment",
            mode: "test",
            plannedCollectionDate: null,
            subscriptionId: "subscription_1",
            tenantId: "tenant_1",
          },
          {
            customerEmail: null,
            customerId: "customer_1",
            entityId: "payment_skipped",
            invoiceDocumentUrl: null,
            invoiceId: null,
            invoiceNumber: null,
            invoiceProvider: "eboekhouden",
            invoiceType: "first_payment",
            mode: "test",
            plannedCollectionDate: null,
            subscriptionId: "subscription_1",
            tenantId: "tenant_1",
          },
        ]},
      },
    );

    assert.deepEqual(delivered, [
      {
        entityId: "payment_sent",
        invoiceType: "first_payment",
        plannedCollectionDate: null,
      },
      {
        entityId: "payment_failed",
        invoiceType: "first_payment",
        plannedCollectionDate: null,
      },
      {
        entityId: "payment_skipped",
        invoiceType: "first_payment",
        plannedCollectionDate: null,
      },
    ]);
    assert.deepEqual(result, {
      attemptedCount: 3,
      failedCount: 1,
      sentCount: 1,
      skippedCount: 1,
    });
  });

  it("maps recurring retry candidates into delivery attempts", async () => {
    const delivered: Array<{
      entityId: string;
      invoiceType: "first_payment" | "recurring";
      plannedCollectionDate?: string | null;
    }> = [];

    const result = await retryInvoiceDeliveryEmailsBatchWithDependencies(
      {
        actor: { kind: "user" },
        limit: 10,
        mode: "live",
        tenantId: "tenant_2",
      },
      {
        deliverCustomerInvoiceEmail: async (input) => {
          delivered.push({
            entityId: input.entityId,
            invoiceType: input.invoiceType,
            plannedCollectionDate: input.plannedCollectionDate ?? null,
          });

          if (input.entityId === "schedule_sent") {
            return { status: "sent" as const };
          }

          return { status: "skipped" as const };
        },
        loadCandidates: async (_mode, _limit, tenantId) => {
          assert.equal(tenantId, "tenant_2");
          return [
          {
            customerEmail: "ops@example.com",
            customerId: "customer_2",
            entityId: "schedule_sent",
            invoiceDocumentUrl: null,
            invoiceId: "222",
            invoiceNumber: "INV-222",
            invoiceProvider: "eboekhouden",
            invoiceType: "recurring",
            mode: "live",
            plannedCollectionDate: "2026-06-09",
            subscriptionId: "subscription_2",
            tenantId: "tenant_2",
          },
          {
            customerEmail: "ops@example.com",
            customerId: "customer_2",
            entityId: "schedule_skipped",
            invoiceDocumentUrl: null,
            invoiceId: "223",
            invoiceNumber: "INV-223",
            invoiceProvider: "eboekhouden",
            invoiceType: "recurring",
            mode: "live",
            plannedCollectionDate: "2026-06-10",
            subscriptionId: "subscription_2",
            tenantId: "tenant_2",
          },
        ]},
      },
    );

    assert.deepEqual(delivered, [
      {
        entityId: "schedule_sent",
        invoiceType: "recurring",
        plannedCollectionDate: "2026-06-09",
      },
      {
        entityId: "schedule_skipped",
        invoiceType: "recurring",
        plannedCollectionDate: "2026-06-10",
      },
    ]);
    assert.deepEqual(result, {
      attemptedCount: 2,
      failedCount: 0,
      sentCount: 1,
      skippedCount: 1,
    });
  });
});
