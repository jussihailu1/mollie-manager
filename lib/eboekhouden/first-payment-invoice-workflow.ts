import {
  billingSettingsAreComplete,
  getTenantBillingSettings,
  type TenantBillingSettings,
} from "@/lib/billing-settings";
import { createEboekhoudenInvoice, type EboekhoudenInvoice } from "@/lib/eboekhouden/client";
import { verifiedEboekhoudenInvoice } from "@/lib/eboekhouden/invoice-total-verification";
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
import { eboekhoudenInvoiceDescription, eboekhoudenTaxFields, requireTaxTreatment } from "@/lib/invoicing/tax-treatment";

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
    getFirstPaymentInvoiceCandidate(paymentId, options.tenantId),
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

  const taxTreatment = requireTaxTreatment(settings!.taxTreatment);
  const claimedPaymentId = await claimFirstPaymentInvoiceForCreation({
    actor,
    mode: candidate.mode,
    paymentId,
    tenantId: options.tenantId,
    taxTreatment,
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
  let externalInvoice: EboekhoudenInvoice | null = null;
  let postAttempted = false;

  try {
    const existing = await findExistingEboekhoudenInvoiceByReference({
      date: invoiceDate,
      reference,
      relationId: eligibleCandidate.eboekhoudenRelationId,
      tenantId: candidate.tenantId,
    });

    if (existing.status === "ambiguous") {
      throw new Error(
        `Ambiguous e-Boekhouden invoice match for reference ${reference}; manual review required.`,
      );
    }

    if (existing.status === "found") {
      externalInvoice = existing.invoice;
      const verifiedInvoice = await verifiedEboekhoudenInvoice({ expectedAmount: candidate.amountValue, expectedRelationId: eligibleCandidate.eboekhoudenRelationId, expectedReference: reference, invoice: existing.invoice, taxTreatment, tenantId: candidate.tenantId });
      const storedRecoveredInvoice = await storeFirstPaymentInvoiceCreationSuccess({
        actor,
        candidate,
        invoice: verifiedInvoice,
        source: "reconciled_existing",
      });
      await deliverCustomerInvoiceEmail(
        buildFirstPaymentInvoiceDelivery({
          actor,
          customerEmail: candidate.customerEmail,
          customerId: candidate.customerId,
          entityId: candidate.paymentId,
          invoiceDocumentUrl: verifiedInvoice.urlPdfFile ?? null,
          invoiceId: storedRecoveredInvoice.invoiceId,
          invoiceNumber: storedRecoveredInvoice.invoiceNumber,
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

    const tax = eboekhoudenTaxFields(taxTreatment);
    const invoiceInput: Parameters<typeof createEboekhoudenInvoice>[0] = {
      date: invoiceDate,
      inExVat: tax.inExVat,
      items: [
        {
          description: eboekhoudenInvoiceDescription(parsedPlanSnapshot.data.description, taxTreatment),
          ledgerId: settings!.revenueLedgerId!,
          pricePerUnit: toInvoiceAmountNumber(candidate.amountValue),
          quantity: 1,
          vatCode: tax.vatCode,
        },
      ],
      print: false,
      reference,
      relationId: eligibleCandidate.eboekhoudenRelationId,
      templateId: settings!.invoiceTemplateId!,
      text: tax.text,
      termOfPayment: 0,
    };
    postAttempted = true;
    const invoice = await createEboekhoudenInvoice(
      invoiceInput,
      candidate.tenantId,
    );
    externalInvoice = invoice;
    const verifiedInvoice = await verifiedEboekhoudenInvoice({ expectedAmount: candidate.amountValue, expectedRelationId: eligibleCandidate.eboekhoudenRelationId, expectedReference: reference, invoice, taxTreatment, tenantId: candidate.tenantId });
    const storedInvoice = await storeFirstPaymentInvoiceCreationSuccess({
      actor,
      candidate,
      invoice: verifiedInvoice,
    });
    await deliverCustomerInvoiceEmail(
      buildFirstPaymentInvoiceDelivery({
        actor,
        customerEmail: candidate.customerEmail,
        customerId: candidate.customerId,
        entityId: candidate.paymentId,
        invoiceDocumentUrl: verifiedInvoice.urlPdfFile ?? null,
        invoiceId: storedInvoice.invoiceId,
        invoiceNumber: storedInvoice.invoiceNumber,
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
    let failureError = error;
    if (isEboekhoudenReferenceAlreadyExistsError(error)) {
      try {
      const existing = await findExistingEboekhoudenInvoiceByReference({
        date: invoiceDate,
        reference,
        relationId: eligibleCandidate.eboekhoudenRelationId,
        tenantId: candidate.tenantId,
      });

      if (existing.status === "found") {
        externalInvoice = existing.invoice;
        const verifiedInvoice = await verifiedEboekhoudenInvoice({ expectedAmount: candidate.amountValue, expectedRelationId: eligibleCandidate.eboekhoudenRelationId, expectedReference: reference, invoice: existing.invoice, taxTreatment, tenantId: candidate.tenantId });
        const storedRecoveredInvoice = await storeFirstPaymentInvoiceCreationSuccess({
          actor,
          candidate,
          invoice: verifiedInvoice,
          source: "reconciled_existing",
        });
        await deliverCustomerInvoiceEmail(
          buildFirstPaymentInvoiceDelivery({
            actor,
            customerEmail: candidate.customerEmail,
            customerId: candidate.customerId,
            entityId: candidate.paymentId,
            invoiceDocumentUrl: verifiedInvoice.urlPdfFile ?? null,
            invoiceId: storedRecoveredInvoice.invoiceId,
            invoiceNumber: storedRecoveredInvoice.invoiceNumber,
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
      } catch (recoveryError) {
        failureError = recoveryError;
      }
    }

    const failure = await storeFirstPaymentInvoiceCreationFailure({
      actor,
      candidate,
      error: failureError,
      externalInvoice,
      postAttempted,
      reference,
    });

    return {
      paymentId,
      reason: failure.errorMessage,
      status: "failed",
    };
  }
}
