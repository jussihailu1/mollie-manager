import "server-only";

import { createEboekhoudenInvoice, getEboekhoudenInvoice } from "@/lib/eboekhouden/client";
import { findExistingEboekhoudenInvoiceByReference } from "@/lib/eboekhouden/invoice-reconcile";
import { type InvoiceProviderAdapter } from "@/lib/invoicing/provider-types";

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

    const invoice = await createEboekhoudenInvoice(
      {
        date: input.invoiceDate,
        inExVat: "EX",
        items: [
          {
            description: input.description,
            ledgerId: input.settings.revenueLedgerId,
            pricePerUnit: Number(input.amountValue),
            quantity: 1,
            vatCode: input.settings.vatCode,
          },
        ],
        print: false,
        reference: input.reference,
        relationId,
        templateId: input.settings.invoiceTemplateId,
        termOfPayment: input.termOfPaymentDays ?? 0,
      },
      input.tenantId,
    );

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
