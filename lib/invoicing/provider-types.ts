import "server-only";

import type { TenantBillingSettings } from "@/lib/billing-settings";
import type { InvoiceProvider, InvoiceOwnerType, StoredInvoiceRecord } from "@/lib/invoices";

export type InvoiceProviderCapabilities = {
  requiresCustomerLink: boolean;
  supportsExistingInvoiceLookup: boolean;
};

export type InvoiceProviderCreateInput = {
  amountCurrency: string;
  amountValue: string;
  customer: {
    address: string | null;
    businessName: string | null;
    email: string | null;
    id: string | null;
    locale: string | null;
    name: string | null;
    phone: string | null;
  };
  description: string;
  invoiceDate: string;
  mode: "live" | "test";
  ownerId: string;
  ownerType: InvoiceOwnerType;
  plannedCollectionDate?: string | null;
  providerCustomerId?: string | null;
  reference: string;
  settings: TenantBillingSettings;
  termOfPaymentDays?: number;
  tenantId: string;
};

export type InvoiceProviderCreateResult = {
  provider: InvoiceProvider;
  providerCustomerId: string | null;
  providerDocumentUrl: string | null;
  providerInvoiceId: string | null;
  providerInvoiceNumber: string | null;
  providerSnapshot: Record<string, unknown>;
};

export type InvoiceProviderExistingLookupResult =
  | {
      invoice: InvoiceProviderCreateResult;
      status: "found";
    }
  | {
      matches?: Record<string, unknown>[];
      status: "ambiguous" | "none";
    };

export interface InvoiceProviderAdapter {
  createInvoice(input: InvoiceProviderCreateInput): Promise<InvoiceProviderCreateResult>;
  findExistingInvoice?(input: {
    date: string;
    providerCustomerId?: string | null;
    reference: string;
    tenantId: string;
  }): Promise<InvoiceProviderExistingLookupResult>;
  getCapabilities(): InvoiceProviderCapabilities;
  getDisplayMetadata(input: { invoice: StoredInvoiceRecord }): {
    providerLabel: string;
  };
  getInvoiceDocument(input: {
    invoice: StoredInvoiceRecord;
    tenantId: string;
  }): Promise<string | null>;
  validateTenantSetup(input: {
    mode: "live" | "test";
    settings: TenantBillingSettings | null;
    tenantId: string;
  }): Promise<{ ok: boolean; reason?: string }>;
}
