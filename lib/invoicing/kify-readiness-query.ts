import "server-only";

import { sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { describeKifyInvoiceReadiness } from "@/lib/invoicing/kify-readiness";
type KifyProfileRow = {
  city: string | null;
  countryCode: string | null;
  houseNumber: string | null;
  invoiceEmail: string | null;
  invoicePrefix: string | null;
  kvkNumber: string | null;
  paymentTermDays: number | null;
  postalCode: string | null;
  street: string | null;
  vatId: string | null;
  customerLegalName: string | null;
  customerCity: string | null;
  customerCountryCode: string | null;
  customerEmail: string | null;
  customerHouseNumber: string | null;
  customerPostalCode: string | null;
  customerStreet: string | null;
  tenantLegalName: string | null;
};

export async function getKifyInvoiceReadiness(input: { customerId: string; tenantId: string }) {
  const result = await getDb().execute<KifyProfileRow>(sql`
    select
      tip.legal_name as "tenantLegalName", tip.street, tip.house_number as "houseNumber",
      tip.postal_code as "postalCode", tip.city, tip.country_code as "countryCode",
      tip.kvk_number as "kvkNumber", tip.vat_id as "vatId", tip.invoice_email as "invoiceEmail",
      tip.invoice_prefix as "invoicePrefix", tip.payment_term_days as "paymentTermDays",
      cbp.legal_name as "customerLegalName", cbp.street as "customerStreet",
      cbp.house_number as "customerHouseNumber", cbp.postal_code as "customerPostalCode",
      cbp.city as "customerCity", cbp.country_code as "customerCountryCode", cbp.email as "customerEmail"
    from tenants t
    left join tenant_invoice_profiles tip on tip.tenant_id = t.id
    left join customer_billing_profiles cbp
      on cbp.tenant_id = t.id and cbp.customer_id = ${input.customerId}
    where t.id = ${input.tenantId}
    limit 1
  `);
  const row = result.rows[0];
  const tenantProfile = row?.tenantLegalName && row.city && row.countryCode && row.houseNumber && row.invoiceEmail && row.invoicePrefix && row.kvkNumber && row.paymentTermDays !== null && row.postalCode && row.street && row.vatId
    ? { city: row.city, countryCode: row.countryCode, houseNumber: row.houseNumber, invoiceEmail: row.invoiceEmail, invoicePrefix: row.invoicePrefix, kvkNumber: row.kvkNumber, legalName: row.tenantLegalName, paymentTermDays: row.paymentTermDays, postalCode: row.postalCode, street: row.street, vatId: row.vatId }
    : null;
  const customerProfile = row?.customerLegalName && row.customerCity && row.customerCountryCode && row.customerEmail && row.customerHouseNumber && row.customerPostalCode && row.customerStreet
    ? { city: row.customerCity, countryCode: row.customerCountryCode, email: row.customerEmail, houseNumber: row.customerHouseNumber, legalName: row.customerLegalName, postalCode: row.customerPostalCode, street: row.customerStreet }
    : null;
  return describeKifyInvoiceReadiness({
    tenantProfile,
    customerProfile,
  });
}
