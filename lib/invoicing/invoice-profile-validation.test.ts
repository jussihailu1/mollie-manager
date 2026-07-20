import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  validateCustomerBillingProfile,
  validateTenantInvoiceProfile,
} from "@/lib/invoicing/invoice-profile-validation";

const tenantProfile = {
  city: "Amsterdam", countryCode: "NL", houseNumber: "1", invoiceEmail: "factuur@example.nl",
  invoicePrefix: "KFY", kvkNumber: "12345678", legalName: "Example B.V.", paymentTermDays: 14,
  postalCode: "1011AA", street: "Damrak", vatId: "NL123456789B01",
};
const customerProfile = {
  city: "Amsterdam", countryCode: "NL", email: "klant@example.nl", houseNumber: "2",
  legalName: "Klant B.V.", postalCode: "1012AA", street: "Rokin",
};

describe("Kify invoice profile validation", () => {
  it("accepts complete deterministic billing profiles", () => {
    assert.doesNotThrow(() => validateTenantInvoiceProfile(tenantProfile));
    assert.doesNotThrow(() => validateCustomerBillingProfile(customerProfile));
  });

  it("fails incomplete profiles before invoice allocation", () => {
    assert.throws(() => validateTenantInvoiceProfile({ ...tenantProfile, vatId: "" }), /VAT ID/);
    assert.throws(() => validateCustomerBillingProfile({ ...customerProfile, legalName: "" }), /legal name/);
  });
});
