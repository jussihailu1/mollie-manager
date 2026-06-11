export type FirstPaymentInvoiceEligibilityCandidate = {
  consentAcceptedAt: string | null;
  eboekhoudenRelationId: number | null;
  firstPaymentMode: "mandate_only" | "real_installment";
};

export type FirstPaymentInvoiceEligibility =
  | {
      status: "eligible";
      candidate: {
        consentAcceptedAt: string;
        eboekhoudenRelationId: number;
        firstPaymentMode: "real_installment";
      };
    }
  | {
      reason: string;
      status: "skipped";
    };

export function describeFirstPaymentInvoiceEligibility(
  candidate: FirstPaymentInvoiceEligibilityCandidate | null,
): FirstPaymentInvoiceEligibility {
  if (!candidate) {
    return {
      reason:
        "First payment was not found or did not match a deterministic accepted onboarding consent.",
      status: "skipped",
    };
  }

  if (!candidate.eboekhoudenRelationId) {
    return {
      reason:
        "Customer is not linked to an e-Boekhouden relation. Link the customer before creating the invoice.",
      status: "skipped",
    };
  }

  if (!candidate.consentAcceptedAt) {
    return {
      reason: "The matched onboarding consent is not accepted yet.",
      status: "skipped",
    };
  }

  if (candidate.firstPaymentMode !== "real_installment") {
    return {
      reason: "Mandate-only first payments must not create a normal invoice.",
      status: "skipped",
    };
  }

  return {
    status: "eligible",
    candidate: {
      consentAcceptedAt: candidate.consentAcceptedAt,
      eboekhoudenRelationId: candidate.eboekhoudenRelationId,
      firstPaymentMode: "real_installment",
    },
  };
}
