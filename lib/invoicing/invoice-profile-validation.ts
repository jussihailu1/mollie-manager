export type TenantInvoiceProfileInput = {
  city: string;
  countryCode: string;
  houseNumber: string;
  invoiceEmail: string;
  invoicePrefix: string;
  kvkNumber: string;
  legalName: string;
  paymentTermDays: number;
  postalCode: string;
  street: string;
  vatId: string;
};

export type CustomerBillingProfileInput = {
  city: string;
  countryCode: string;
  email: string;
  houseNumber: string;
  legalName: string;
  postalCode: string;
  street: string;
};

function required(value: string, label: string) {
  if (!value.trim()) {
    throw new Error(`${label} is required before Kify invoice allocation.`);
  }
}

function validateCountry(value: string) {
  if (!/^[A-Z]{2}$/.test(value)) {
    throw new Error("Billing country code must be a two-letter uppercase ISO code.");
  }
}

function validateEmail(value: string, label: string) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw new Error(`${label} must be a valid email address.`);
  }
}

export function validateTenantInvoiceProfile(profile: TenantInvoiceProfileInput) {
  required(profile.legalName, "Tenant legal name");
  required(profile.street, "Tenant street");
  required(profile.houseNumber, "Tenant house number");
  required(profile.postalCode, "Tenant postal code");
  required(profile.city, "Tenant city");
  required(profile.kvkNumber, "Tenant KVK number");
  required(profile.vatId, "Tenant VAT ID");
  validateCountry(profile.countryCode);
  validateEmail(profile.invoiceEmail, "Tenant invoice email");
  if (!/^[A-Z0-9-]+$/.test(profile.invoicePrefix)) {
    throw new Error("Invoice prefix must be uppercase letters, numbers, or hyphens.");
  }
  if (!Number.isInteger(profile.paymentTermDays) || profile.paymentTermDays < 0) {
    throw new Error("Payment term days must be a non-negative integer.");
  }
}

export function validateCustomerBillingProfile(profile: CustomerBillingProfileInput) {
  required(profile.legalName, "Customer legal name");
  required(profile.street, "Customer street");
  required(profile.houseNumber, "Customer house number");
  required(profile.postalCode, "Customer postal code");
  required(profile.city, "Customer city");
  validateCountry(profile.countryCode);
  validateEmail(profile.email, "Customer billing email");
}
