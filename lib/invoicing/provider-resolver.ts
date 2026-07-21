import "server-only";

import { getTenantBillingSettings } from "@/lib/billing-settings";
import type { InvoiceProvider } from "@/lib/invoices";
import { eboekhoudenInvoiceProvider } from "@/lib/invoicing/providers/eboekhouden";
import { mollieInvoiceProvider } from "@/lib/invoicing/providers/mollie";

export function getInvoiceProviderAdapterById(provider: InvoiceProvider) {
  if (provider === "eboekhouden") return eboekhoudenInvoiceProvider;
  if (provider === "mollie") return mollieInvoiceProvider;

  throw new Error("Kify invoice issuance must use the Kify workflow; no legacy provider fallback is allowed.");
}

export async function getTenantInvoiceProviderAdapter(tenantId: string) {
  const settings = await getTenantBillingSettings(tenantId);
  const provider = settings?.activeInvoiceProvider ?? "mollie";

  return getInvoiceProviderAdapterById(provider);
}
