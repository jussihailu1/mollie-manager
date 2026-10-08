import "server-only";

import { createEboekhoudenInvoice, getEboekhoudenInvoice } from "@/lib/eboekhouden/client";
import { findExistingEboekhoudenInvoiceByReference } from "@/lib/eboekhouden/invoice-reconcile";
import { verifiedEboekhoudenInvoice } from "@/lib/eboekhouden/invoice-total-verification";
import { type InvoiceProviderAdapter } from "@/lib/invoicing/provider-types";
import { eboekhoudenInvoiceDescription, eboekhoudenTaxFields, requireTaxTreatment } from "@/lib/invoicing/tax-treatment";
import { toInvoiceAmountNumber } from "@/lib/eboekhouden/invoice-flow-helpers";

export const eboekhoudenInvoiceProvider: InvoiceProviderAdapter = {
  async createInvoice(input) {
    if (!input.providerCustomerId) {
      throw new Error("e-Boekhouden relation link is missing.");
    }

    if (!input.settings.invoiceTemplateId || !input.settings.revenueLedgerId) {
      throw new Error(
        "Tenant e-Boekhouden invoice settings are incomplete.",
      );
    }

    const relationId = Number(input.providerCustomerId);
    if (!Number.isInteger(relationId) || relationId <= 0) {
      throw new Error("Stored e-Boekhouden relation id is invalid.");
    }

    const taxTreatment = requireTaxTreatment(input.settings.taxTreatment);
    const tax = eboekhoudenTaxFields(taxTreatment);
    const createdInvoice = await createEboekhoudenInvoice(
      {
        date: input.invoiceDate,
        inExVat: tax.inExVat,
        items: [
          {
            description: eboekhoudenInvoiceDescription(input.description, taxTreatment),
            ledgerId: input.settings.revenueLedgerId,
            pricePerUnit: toInvoiceAmountNumber(input.amountValue),
            quantity: 1,
            vatCode: tax.vatCode,
          },
        ],
        print: false,
        reference: input.reference,
        relationId,
        templateId: input.settings.invoiceTemplateId,
        text: tax.text,
        termOfPayment: input.termOfPaymentDays ?? 0,
      },
      input.tenantId,
    );
    const invoice = await verifiedEboekhoudenInvoice({ expectedAmount: input.amountValue, expectedRelationId: relationId, expectedReference: input.reference, invoice: createdInvoice, taxTreatment, tenantId: input.tenantId });

    return {
      provider: "eboekhouden",
      providerCustomerId: input.providerCustomerId,
      providerDocumentUrl: invoice.urlPdfFile ?? null,
      providerInvoiceId: invoice.id ? String(invoice.id) : null,
      providerInvoiceNumber: invoice.invoiceNumber ?? invoice.number ?? null,
      providerSnapshot: invoice as Record<string, unknown>,
    };
  },

  async findExistingInvoice(input) {
    if (!input.providerCustomerId) {
      return { status: "none" };
    }

    const relationId = Number(input.providerCustomerId);
    if (!Number.isInteger(relationId) || relationId <= 0) {
      return { status: "none" };
    }

    const existing = await findExistingEboekhoudenInvoiceByReference({
      date: input.date,
      reference: input.reference,
      relationId,
      tenantId: input.tenantId,
    });

    if (existing.status === "none") {
      return { status: "none" };
    }

    if (existing.status === "ambiguous") {
      return {
        matches: existing.matches as unknown as Record<string, unknown>[],
        status: "ambiguous",
      };
    }

    return {
      invoice: {
        provider: "eboekhouden",
        providerCustomerId: input.providerCustomerId,
        providerDocumentUrl: existing.invoice.urlPdfFile ?? null,
        providerInvoiceId: existing.invoice.id
          ? String(existing.invoice.id)
          : null,
        providerInvoiceNumber:
          existing.invoice.invoiceNumber ?? existing.invoice.number ?? null,
        providerSnapshot: existing.invoice as Record<string, unknown>,
      },
      status: "found",
    };
  },

  getCapabilities() {
    return {
      requiresCustomerLink: true,
      supportsExistingInvoiceLookup: true,
    };
  },

  getDisplayMetadata() {
    return {
      providerLabel: "e-Boekhouden",
    };
  },

  async getInvoiceDocument(input) {
    if (input.invoice.providerDocumentUrl) {
      return input.invoice.providerDocumentUrl;
    }

    if (!input.invoice.providerInvoiceId) {
      return null;
    }

    const invoiceId = Number(input.invoice.providerInvoiceId);
    if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
      return null;
    }

    const invoice = await getEboekhoudenInvoice(invoiceId, input.tenantId);
    return invoice.urlPdfFile ?? null;
  },

  async validateTenantSetup(input) {
    const settings = input.settings;

    if (!settings) {
      return { ok: false, reason: "Tenant invoice settings are missing." };
    }

    if (settings.taxTreatment !== "kor" && settings.taxTreatment !== "standard") {
      return { ok: false, reason: "Select the organization's KOR status before issuing invoices." };
    }

    if (!settings.invoiceTemplateId || !settings.revenueLedgerId) {
      return {
        ok: false,
        reason:
          "Select an e-Boekhouden invoice template and revenue ledger first.",
      };
    }

    return { ok: true };
  },
};
