import "server-only";

import {
  getTenantBillingSettings,
  type TenantBillingSettings,
} from "@/lib/billing-settings";
import { mollieInvoiceProvider } from "@/lib/invoicing/providers/mollie";

export async function getTenantMollieInvoicingReadiness(input: {
  billingSettings?: TenantBillingSettings | null;
  tenantId: string;
}) {
  const billingSettings = input.billingSettings ?? await getTenantBillingSettings(input.tenantId);
  if (billingSettings?.activeInvoiceProvider !== "mollie") {
    return { enabled: true, required: false };
  }

  const result = await mollieInvoiceProvider.validateTenantSetup({
    mode: "live",
    settings: billingSettings,
    tenantId: input.tenantId,
  });

  return { enabled: result.ok, required: true };
}
