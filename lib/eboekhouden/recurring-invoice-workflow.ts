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
import { buildRecurringInvoiceReference } from "@/lib/eboekhouden/invoice-reference";
import {
  getScheduledInvoiceCandidate,
  type ScheduledInvoiceCandidate,
} from "@/lib/eboekhouden/recurring-invoice-candidate";
import {
  claimScheduleForInvoice,
  storeRecurringInvoiceCreationFailure,
  storeRecurringInvoiceCreationSuccess,
  type RecurringInvoiceActor,
} from "@/lib/eboekhouden/recurring-invoice-persistence";
import { findExistingEboekhoudenInvoiceByReference } from "@/lib/eboekhouden/invoice-reconcile";
import { deliverCustomerInvoiceEmail } from "@/lib/invoice-delivery";
import { eboekhoudenInvoiceDescription, eboekhoudenTaxFields, requireTaxTreatment } from "@/lib/invoicing/tax-treatment";

type CreateScheduleInvoiceResult =
  | {
      invoiceId: string | null;
      invoiceNumber: string | null;
      scheduleId: string;
      status: "created";
    }
  | {
      scheduleId: string;
      reason: string;
      status: "failed" | "skipped";
    };

function daysBetween(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00Z`).getTime();
  const end = new Date(`${endDate}T00:00:00Z`).getTime();
  return Math.max(Math.round((end - start) / 86_400_000), 0);
}

function buildReference(candidate: ScheduledInvoiceCandidate) {
  return buildRecurringInvoiceReference({
    plannedCollectionDate: candidate.plannedCollectionDate,
    scheduleId: candidate.scheduleId,
  });
}

export async function createEboekhoudenInvoiceForSchedule(
  scheduleId: string,
  options: {
    actor?: RecurringInvoiceActor;
    tenantId: string;
    settings?: TenantBillingSettings | null;
  },
): Promise<CreateScheduleInvoiceResult> {
  const actor = options.actor ?? {
    kind: "system",
  };
  const [settings, candidate] = await Promise.all([
    options.settings
      ? Promise.resolve(options.settings)
      : getTenantBillingSettings(options.tenantId),
    getScheduledInvoiceCandidate(scheduleId, options.tenantId),
  ]);

  if (!billingSettingsAreComplete(settings)) {
    throw new Error(
      "Tenant billing settings are incomplete. Select an invoice template and revenue ledger first.",
    );
  }

  if (!candidate) {
    throw new Error("Recurring billing schedule was not found.");
  }

  if (!candidate.eboekhoudenRelationId) {
    return {
      reason:
        "Customer is not linked to an e-Boekhouden relation. Link the customer before creating the invoice.",
      scheduleId,
      status: "skipped",
    };
  }

  const taxTreatment = requireTaxTreatment(settings!.taxTreatment);
  const claimedScheduleId = await claimScheduleForInvoice({
    actor,
    mode: candidate.mode,
    scheduleId,
    tenantId: options.tenantId,
    taxTreatment,
  });

  if (!claimedScheduleId) {
    return {
      reason: "Schedule row was already claimed or already invoiced.",
      scheduleId,
      status: "skipped",
    };
  }

  const reference = buildReference(candidate);
  let externalInvoice: EboekhoudenInvoice | null = null;
  let postAttempted = false;

  try {
    const existing = await findExistingEboekhoudenInvoiceByReference({
      date: candidate.invoiceSendDueDate,
      reference,
      relationId: candidate.eboekhoudenRelationId,
      tenantId: candidate.tenantId,
    });

    if (existing.status === "ambiguous") {
      throw new Error(
        `Ambiguous e-Boekhouden invoice match for reference ${reference}; manual review required.`,
      );
    }

    if (existing.status === "found") {
      externalInvoice = existing.invoice;
      const verifiedInvoice = await verifiedEboekhoudenInvoice({ expectedAmount: candidate.amountValue, expectedRelationId: candidate.eboekhoudenRelationId, expectedReference: reference, invoice: existing.invoice, taxTreatment, tenantId: candidate.tenantId });
      const storedRecoveredInvoice = await storeRecurringInvoiceCreationSuccess({
        actor,
        candidate,
        invoice: verifiedInvoice,
        source: "reconciled_existing",
      });
      await deliverCustomerInvoiceEmail({
        actor,
        customerEmail: candidate.customerEmail,
        customerId: candidate.customerId,
        entityId: candidate.scheduleId,
        invoiceDocumentUrl: verifiedInvoice.urlPdfFile ?? null,
        invoiceId: storedRecoveredInvoice.invoiceId,
        invoiceNumber: storedRecoveredInvoice.invoiceNumber,
        invoiceProvider: "eboekhouden",
        invoiceType: "recurring",
        mode: candidate.mode,
        plannedCollectionDate: candidate.plannedCollectionDate,
        subscriptionId: candidate.subscriptionId,
        tenantId: candidate.tenantId,
      });

      return {
        invoiceId: storedRecoveredInvoice.invoiceId,
        invoiceNumber: storedRecoveredInvoice.invoiceNumber,
        scheduleId,
        status: "created",
      };
    }

    const tax = eboekhoudenTaxFields(taxTreatment);
    const invoiceInput: Parameters<typeof createEboekhoudenInvoice>[0] = {
      date: candidate.invoiceSendDueDate,
      inExVat: tax.inExVat,
      items: [
        {
          description: eboekhoudenInvoiceDescription(candidate.subscriptionDescription, taxTreatment),
          ledgerId: settings!.revenueLedgerId!,
          pricePerUnit: toInvoiceAmountNumber(candidate.amountValue),
          quantity: 1,
          vatCode: tax.vatCode,
        },
      ],
      print: false,
      reference,
      relationId: candidate.eboekhoudenRelationId,
      templateId: settings!.invoiceTemplateId!,
      text: tax.text,
      termOfPayment: daysBetween(
        candidate.invoiceSendDueDate,
        candidate.plannedCollectionDate,
      ),
    };
    postAttempted = true;
    const invoice = await createEboekhoudenInvoice(
      invoiceInput,
      candidate.tenantId,
    );
    externalInvoice = invoice;
    const verifiedInvoice = await verifiedEboekhoudenInvoice({ expectedAmount: candidate.amountValue, expectedRelationId: candidate.eboekhoudenRelationId, expectedReference: reference, invoice, taxTreatment, tenantId: candidate.tenantId });
    const storedInvoice = await storeRecurringInvoiceCreationSuccess({
      actor,
      candidate,
      invoice: verifiedInvoice,
    });
    await deliverCustomerInvoiceEmail({
      actor,
      customerEmail: candidate.customerEmail,
      customerId: candidate.customerId,
      entityId: candidate.scheduleId,
      invoiceDocumentUrl: verifiedInvoice.urlPdfFile ?? null,
      invoiceId: storedInvoice.invoiceId,
      invoiceNumber: storedInvoice.invoiceNumber,
      invoiceProvider: "eboekhouden",
      invoiceType: "recurring",
      mode: candidate.mode,
      plannedCollectionDate: candidate.plannedCollectionDate,
      subscriptionId: candidate.subscriptionId,
      tenantId: candidate.tenantId,
    });

    return {
      invoiceId: storedInvoice.invoiceId,
      invoiceNumber: storedInvoice.invoiceNumber,
      scheduleId,
      status: "created",
    };
  } catch (error) {
    let failureError = error;
    if (isEboekhoudenReferenceAlreadyExistsError(error)) {
      try {
      const existing = await findExistingEboekhoudenInvoiceByReference({
        date: candidate.invoiceSendDueDate,
        reference,
        relationId: candidate.eboekhoudenRelationId,
        tenantId: candidate.tenantId,
      });

      if (existing.status === "found") {
        externalInvoice = existing.invoice;
        const verifiedInvoice = await verifiedEboekhoudenInvoice({ expectedAmount: candidate.amountValue, expectedRelationId: candidate.eboekhoudenRelationId, expectedReference: reference, invoice: existing.invoice, taxTreatment, tenantId: candidate.tenantId });
        const storedRecoveredInvoice = await storeRecurringInvoiceCreationSuccess({
          actor,
          candidate,
          invoice: verifiedInvoice,
          source: "reconciled_existing",
        });
        await deliverCustomerInvoiceEmail({
          actor,
          customerEmail: candidate.customerEmail,
          customerId: candidate.customerId,
          entityId: candidate.scheduleId,
          invoiceDocumentUrl: verifiedInvoice.urlPdfFile ?? null,
          invoiceId: storedRecoveredInvoice.invoiceId,
          invoiceNumber: storedRecoveredInvoice.invoiceNumber,
          invoiceProvider: "eboekhouden",
          invoiceType: "recurring",
          mode: candidate.mode,
          plannedCollectionDate: candidate.plannedCollectionDate,
          subscriptionId: candidate.subscriptionId,
          tenantId: candidate.tenantId,
        });

        return {
          invoiceId: storedRecoveredInvoice.invoiceId,
          invoiceNumber: storedRecoveredInvoice.invoiceNumber,
          scheduleId,
          status: "created",
        };
      }
      } catch (recoveryError) {
        failureError = recoveryError;
      }
    }

    const errorMessage = await storeRecurringInvoiceCreationFailure({
      actor,
      candidate,
      error: failureError,
      externalInvoice,
      postAttempted,
      reference,
    });

    return {
      reason: errorMessage,
      scheduleId,
      status: "failed",
    };
  }
}
