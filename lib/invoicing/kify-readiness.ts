import {
  validateCustomerBillingProfile,
  validateTenantInvoiceProfile,
  type CustomerBillingProfileInput,
  type TenantInvoiceProfileInput,
} from "@/lib/invoicing/invoice-profile-validation";

export function describeKifyInvoiceReadiness(input: {
  customerProfile: CustomerBillingProfileInput | null;
  tenantProfile: TenantInvoiceProfileInput | null;
}) {
  try {
    if (!input.tenantProfile) throw new Error("Complete the tenant invoice profile before creating a Kify invoice.");
    if (!input.customerProfile) throw new Error("Complete the customer billing profile before creating a Kify invoice.");
    validateTenantInvoiceProfile(input.tenantProfile);
    validateCustomerBillingProfile(input.customerProfile);
    return { ok: true as const };
  } catch (error) {
    return {
      ok: false as const,
      reason: error instanceof Error ? error.message : "Kify invoice profiles are incomplete.",
    };
  }
}

export function describeKifyTenantInvoiceReadiness(input: {
  tenantProfile: TenantInvoiceProfileInput | null;
}) {
  try {
    if (!input.tenantProfile) throw new Error("Complete the tenant invoice profile before enabling Kify invoicing.");
    validateTenantInvoiceProfile(input.tenantProfile);
    return { ok: true as const };
  } catch (error) {
    return {
      ok: false as const,
      reason: error instanceof Error ? error.message : "Kify invoice profile is incomplete.",
    };
  }
}
