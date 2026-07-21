import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { describeKifyInvoiceReadiness } from "@/lib/invoicing/kify-readiness";

const tenantProfile = { city: "Utrecht", countryCode: "NL", houseNumber: "1", invoiceEmail: "factuur@example.test", invoicePrefix: "KFY", kvkNumber: "12345678", legalName: "Kify B.V.", paymentTermDays: 14, postalCode: "1234AB", street: "Straat", vatId: "NL123456789B01" };
const customerProfile = { city: "Utrecht", countryCode: "NL", email: "klant@example.test", houseNumber: "2", legalName: "Klant B.V.", postalCode: "1234AB", street: "Straat" };

describe("Kify invoice readiness", () => {
  it("requires complete tenant and customer profiles", () => {
    assert.deepEqual(describeKifyInvoiceReadiness({ customerProfile, tenantProfile }), { ok: true });
    assert.equal(describeKifyInvoiceReadiness({ customerProfile: null, tenantProfile }).ok, false);
    assert.equal(describeKifyInvoiceReadiness({ customerProfile, tenantProfile: null }).ok, false);
  });
});
