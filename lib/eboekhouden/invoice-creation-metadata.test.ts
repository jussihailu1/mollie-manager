import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildInvoiceCreationClaimMetadata,
  buildInvoiceCreationFailureMetadata,
  buildInvoiceCreationSuccessMetadata,
} from "@/lib/eboekhouden/invoice-creation-metadata";

describe("invoice creation metadata helpers", () => {
  it("builds claim metadata with actor evidence", () => {
    assert.deepEqual(
      buildInvoiceCreationClaimMetadata({
        actorEmail: "ops@example.test",
        claimedAt: "2026-06-09T09:00:00.000Z",
        taxTreatment: "kor",
      }),
      {
        invoiceCreationClaimedAt: "2026-06-09T09:00:00.000Z",
        invoiceCreationClaimedBy: "ops@example.test",
        invoiceTaxTreatment: "kor",
      },
    );
  });

  it("builds success metadata with invoice snapshot", () => {
    const invoice = { id: 123, invoiceNumber: "2026-001" };

    assert.deepEqual(
      buildInvoiceCreationSuccessMetadata({
        completedAt: "2026-06-09T10:00:00.000Z",
        invoice,
      }),
      {
        eboekhoudenInvoice: invoice,
        invoiceCreationCompletedAt: "2026-06-09T10:00:00.000Z",
        invoiceCreationStatus: "success",
        invoiceCreationManualReview: false,
        eboekhoudenUnverifiedInvoice: null,
      },
    );
  });

  it("builds failure metadata with serialized error", () => {
    assert.deepEqual(
      buildInvoiceCreationFailureMetadata({
        completedAt: "2026-06-09T10:00:00.000Z",
        errorMessage: "FACT_014 duplicate",
      }),
      {
        invoiceCreationCompletedAt: "2026-06-09T10:00:00.000Z",
        invoiceCreationError: "FACT_014 duplicate",
        invoiceCreationStatus: "failure",
        invoiceCreationManualReview: false,
        eboekhoudenUnverifiedInvoice: null,
      },
    );
  });

  it("holds an uncertain POST for manual review", () => {
    const metadata = buildInvoiceCreationFailureMetadata({
      errorMessage: "Request timed out",
      postAttempted: true,
      reference: "RB-123",
    });
    assert.equal(metadata.invoiceCreationManualReview, true);
    assert.equal(metadata.eboekhoudenUnverifiedInvoice, null);
  });
});
