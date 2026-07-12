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

  const claimedScheduleId = await claimScheduleForInvoice({
    actor,
    mode: candidate.mode,
    scheduleId,
    tenantId: options.tenantId,
  });

  if (!claimedScheduleId) {
    return {
      reason: "Schedule row was already claimed or already invoiced.",
      scheduleId,
      status: "skipped",
    };
  }

  const reference = buildReference(candidate);

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
      const storedRecoveredInvoice = await storeRecurringInvoiceCreationSuccess({
        actor,
        candidate,
        invoice: existing.invoice,
        source: "reconciled_existing",
      });
      await deliverCustomerInvoiceEmail({
        actor,
        customerEmail: candidate.customerEmail,
        customerId: candidate.customerId,
        entityId: candidate.scheduleId,
        invoiceDocumentUrl: existing.invoice.urlPdfFile ?? null,
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

    const invoiceInput: Parameters<typeof createEboekhoudenInvoice>[0] = {
      date: candidate.invoiceSendDueDate,
      inExVat: "EX",
      items: [
        {
          description: candidate.subscriptionDescription,
          ledgerId: settings!.revenueLedgerId!,
          pricePerUnit: toInvoiceAmountNumber(candidate.amountValue),
          quantity: 1,
          vatCode: settings!.vatCode,
        },
      ],
      print: false,
      reference,
      relationId: candidate.eboekhoudenRelationId,
      templateId: settings!.invoiceTemplateId!,
      termOfPayment: daysBetween(
        candidate.invoiceSendDueDate,
        candidate.plannedCollectionDate,
      ),
    };
    const invoice = await createEboekhoudenInvoice(
      invoiceInput,
      candidate.tenantId,
    );
    const storedInvoice = await storeRecurringInvoiceCreationSuccess({
      actor,
      candidate,
      invoice,
    });
    await deliverCustomerInvoiceEmail({
      actor,
      customerEmail: candidate.customerEmail,
      customerId: candidate.customerId,
      entityId: candidate.scheduleId,
      invoiceDocumentUrl: invoice.urlPdfFile ?? null,
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
    if (isEboekhoudenReferenceAlreadyExistsError(error)) {
      const existing = await findExistingEboekhoudenInvoiceByReference({
        date: candidate.invoiceSendDueDate,
        reference,
        relationId: candidate.eboekhoudenRelationId,
        tenantId: candidate.tenantId,
      });

      if (existing.status === "found") {
        const storedRecoveredInvoice = await storeRecurringInvoiceCreationSuccess({
          actor,
          candidate,
          invoice: existing.invoice,
          source: "reconciled_existing",
        });
        await deliverCustomerInvoiceEmail({
          actor,
          customerEmail: candidate.customerEmail,
          customerId: candidate.customerId,
          entityId: candidate.scheduleId,
          invoiceDocumentUrl: existing.invoice.urlPdfFile ?? null,
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
    }

    const errorMessage = await storeRecurringInvoiceCreationFailure({
      actor,
      candidate,
      error,
    });

    return {
      reason: errorMessage,
      scheduleId,
      status: "failed",
    };
  }
}
