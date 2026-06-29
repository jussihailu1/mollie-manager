import {
  billingSettingsAreComplete,
  getTenantBillingSettings,
  type TenantBillingSettings,
} from "@/lib/billing-settings";
import { createEboekhoudenInvoice } from "@/lib/eboekhouden/client";
import {
  isEboekhoudenReferenceAlreadyExistsError,
  toInvoiceAmountNumber,
} from "@/lib/eboekhouden/invoice-flow-helpers";
import { buildFirstPaymentInvoiceReference } from "@/lib/eboekhouden/invoice-reference";
import {
  describeFirstPaymentInvoiceEligibility,
} from "@/lib/eboekhouden/first-payment-invoice-eligibility";
import { buildFirstPaymentInvoiceDelivery } from "@/lib/eboekhouden/first-payment-invoice-delivery";
import {
  getFirstPaymentInvoiceCandidate,
  type FirstPaymentInvoiceCandidate,
} from "@/lib/eboekhouden/first-payment-invoice-candidate";
import {
  claimFirstPaymentInvoiceForCreation,
  storeFirstPaymentInvoiceCreationFailure,
  storeFirstPaymentInvoiceCreationSuccess,
  type FirstPaymentInvoiceActor,
} from "@/lib/eboekhouden/first-payment-invoice-persistence";
import { resolveFirstPaymentInvoiceDate } from "@/lib/eboekhouden/first-payment-invoice-date";
import { findExistingEboekhoudenInvoiceByReference } from "@/lib/eboekhouden/invoice-reconcile";
import { deliverCustomerInvoiceEmail } from "@/lib/invoice-delivery";
import { subscriptionConsentPlanSnapshotSchema } from "@/lib/subscription-consent";

type CreateFirstPaymentInvoiceResult =
  | {
      invoiceId: string | null;
      invoiceNumber: string | null;
      paymentId: string;
      status: "created";
    }
  | {
      paymentId: string;
      reason: string;
      status: "failed" | "skipped";
    };

function buildReference(candidate: FirstPaymentInvoiceCandidate) {
  return buildFirstPaymentInvoiceReference({
    invoiceDate: resolveFirstPaymentInvoiceDate({
      paidAt: candidate.paidAt,
      paymentCreatedAt: candidate.paymentCreatedAt,
    }),
    paymentId: candidate.paymentId,
  });
}

export async function createEboekhoudenInvoiceForFirstPayment(
  paymentId: string,
  options: {
    actor?: FirstPaymentInvoiceActor;
    tenantId: string;
    settings?: TenantBillingSettings | null;
  },
): Promise<CreateFirstPaymentInvoiceResult> {
  const actor = options.actor ?? {
    kind: "system",
  };
  const [settings, candidate] = await Promise.all([
    options.settings
      ? Promise.resolve(options.settings)
      : getTenantBillingSettings(options.tenantId),
    getFirstPaymentInvoiceCandidate(paymentId),
  ]);

  if (!billingSettingsAreComplete(settings)) {
    throw new Error(
      "Tenant billing settings are incomplete. Select an invoice template and revenue ledger first.",
    );
  }

  const eligibility = describeFirstPaymentInvoiceEligibility(
    candidate
      ? {
          consentAcceptedAt: candidate.consentAcceptedAt,
          eboekhoudenRelationId: candidate.eboekhoudenRelationId,
          firstPaymentMode: candidate.firstPaymentMode,
        }
      : null,
  );

  if (eligibility.status === "skipped") {
    return {
      paymentId,
      reason: eligibility.reason,
      status: "skipped",
    };
  }
  const eligibleCandidate = eligibility.candidate;

  const claimedPaymentId = await claimFirstPaymentInvoiceForCreation({
    actor,
    mode: candidate.mode,
    paymentId,
  });

  if (!claimedPaymentId) {
    return {
      paymentId,
      reason: "Payment row was already claimed, already invoiced, or is no longer pending invoice creation.",
      status: "skipped",
    };
  }

  const invoiceDate = resolveFirstPaymentInvoiceDate({
    paidAt: candidate.paidAt,
    paymentCreatedAt: candidate.paymentCreatedAt,
  });
  if (!invoiceDate) {
    const failure = await storeFirstPaymentInvoiceCreationFailure({
      actor,
      candidate,
      error: new Error("Could not derive the invoice date for the paid first payment."),
    });

    return {
      paymentId,
      reason: failure.errorMessage,
      status: "failed",
    };
  }
  const reference = buildReference(candidate);

  try {
    const existing = await findExistingEboekhoudenInvoiceByReference({
      date: invoiceDate,
      reference,
      relationId: eligibleCandidate.eboekhoudenRelationId,
    });

    if (existing.status === "ambiguous") {
      throw new Error(
        `Ambiguous e-Boekhouden invoice match for reference ${reference}; manual review required.`,
      );
    }

    if (existing.status === "found") {
      const storedRecoveredInvoice = await storeFirstPaymentInvoiceCreationSuccess({
        actor,
        candidate,
        invoice: existing.invoice,
        source: "reconciled_existing",
      });
      await deliverCustomerInvoiceEmail(
        buildFirstPaymentInvoiceDelivery({
          actor,
          customerEmail: candidate.customerEmail,
          customerId: candidate.customerId,
          eboekhoudenInvoiceId: storedRecoveredInvoice.invoiceId,
          eboekhoudenInvoiceNumber: storedRecoveredInvoice.invoiceNumber,
          eboekhoudenInvoicePdfUrl: existing.invoice.urlPdfFile ?? null,
          entityId: candidate.paymentId,
          mode: candidate.mode,
          subscriptionId: candidate.subscriptionId,
          tenantId: candidate.tenantId,
        }),
      );

      return {
        invoiceId: storedRecoveredInvoice.invoiceId,
        invoiceNumber: storedRecoveredInvoice.invoiceNumber,
        paymentId,
        status: "created",
      };
    }

    const parsedPlanSnapshot = subscriptionConsentPlanSnapshotSchema.safeParse(
      candidate.planSnapshot,
    );

    if (!parsedPlanSnapshot.success) {
      throw new Error("Stored onboarding consent snapshot is invalid.");
    }

    const invoice = await createEboekhoudenInvoice({
      date: invoiceDate,
      inExVat: "EX",
      items: [
        {
          description: parsedPlanSnapshot.data.description,
          ledgerId: settings!.revenueLedgerId!,
          pricePerUnit: toInvoiceAmountNumber(candidate.amountValue),
          quantity: 1,
          vatCode: settings!.vatCode,
        },
      ],
      print: false,
      reference,
      relationId: eligibleCandidate.eboekhoudenRelationId,
      templateId: settings!.invoiceTemplateId!,
      termOfPayment: 0,
    });
    const storedInvoice = await storeFirstPaymentInvoiceCreationSuccess({
      actor,
      candidate,
      invoice,
    });
    await deliverCustomerInvoiceEmail(
      buildFirstPaymentInvoiceDelivery({
        actor,
        customerEmail: candidate.customerEmail,
        customerId: candidate.customerId,
        eboekhoudenInvoiceId: storedInvoice.invoiceId,
        eboekhoudenInvoiceNumber: storedInvoice.invoiceNumber,
        eboekhoudenInvoicePdfUrl: invoice.urlPdfFile ?? null,
        entityId: candidate.paymentId,
        mode: candidate.mode,
        subscriptionId: candidate.subscriptionId,
        tenantId: candidate.tenantId,
      }),
    );

    return {
      invoiceId: storedInvoice.invoiceId,
      invoiceNumber: storedInvoice.invoiceNumber,
      paymentId,
      status: "created",
    };
  } catch (error) {
    if (isEboekhoudenReferenceAlreadyExistsError(error)) {
      const existing = await findExistingEboekhoudenInvoiceByReference({
        date: invoiceDate,
        reference,
        relationId: eligibleCandidate.eboekhoudenRelationId,
      });

      if (existing.status === "found") {
        const storedRecoveredInvoice = await storeFirstPaymentInvoiceCreationSuccess({
          actor,
          candidate,
          invoice: existing.invoice,
          source: "reconciled_existing",
        });
        await deliverCustomerInvoiceEmail(
          buildFirstPaymentInvoiceDelivery({
            actor,
            customerEmail: candidate.customerEmail,
            customerId: candidate.customerId,
            eboekhoudenInvoiceId: storedRecoveredInvoice.invoiceId,
            eboekhoudenInvoiceNumber: storedRecoveredInvoice.invoiceNumber,
            eboekhoudenInvoicePdfUrl: existing.invoice.urlPdfFile ?? null,
            entityId: candidate.paymentId,
            mode: candidate.mode,
            subscriptionId: candidate.subscriptionId,
            tenantId: candidate.tenantId,
          }),
        );

        return {
          invoiceId: storedRecoveredInvoice.invoiceId,
          invoiceNumber: storedRecoveredInvoice.invoiceNumber,
          paymentId,
          status: "created",
        };
      }
    }

    const failure = await storeFirstPaymentInvoiceCreationFailure({
      actor,
      candidate,
      error,
    });

    return {
      paymentId,
      reason: failure.errorMessage,
      status: "failed",
    };
  }
}
