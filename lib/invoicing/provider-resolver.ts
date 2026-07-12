import "server-only";

import { getTenantBillingSettings } from "@/lib/billing-settings";
import type { InvoiceProvider } from "@/lib/invoices";
import { eboekhoudenInvoiceProvider } from "@/lib/invoicing/providers/eboekhouden";
import { mollieInvoiceProvider } from "@/lib/invoicing/providers/mollie";

export function getInvoiceProviderAdapterById(provider: InvoiceProvider) {
  return provider === "eboekhouden"
    ? eboekhoudenInvoiceProvider
    : mollieInvoiceProvider;
}

export async function getTenantInvoiceProviderAdapter(tenantId: string) {
  const settings = await getTenantBillingSettings(tenantId);
  const provider = settings?.activeInvoiceProvider ?? "mollie";

  return getInvoiceProviderAdapterById(provider);
}
