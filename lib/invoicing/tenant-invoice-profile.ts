import "server-only";

import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { validateTenantInvoiceProfile, type TenantInvoiceProfileInput } from "@/lib/invoicing/invoice-profile-validation";

export async function getTenantInvoiceProfile(tenantId: string): Promise<TenantInvoiceProfileInput | null> {
  const result = await getDb().execute<TenantInvoiceProfileInput>(sql`
    select legal_name as "legalName", street, house_number as "houseNumber", postal_code as "postalCode", city, country_code as "countryCode", kvk_number as "kvkNumber", vat_id as "vatId", invoice_email as "invoiceEmail", payment_term_days as "paymentTermDays", invoice_prefix as "invoicePrefix"
    from tenant_invoice_profiles where tenant_id = ${tenantId} limit 1
  `);
  return result.rows[0] ?? null;
}

export async function saveTenantInvoiceProfile(input: TenantInvoiceProfileInput & { tenantId: string }) {
  validateTenantInvoiceProfile(input);
  await getDb().execute(sql`
    insert into tenant_invoice_profiles (id, tenant_id, legal_name, street, house_number, postal_code, city, country_code, kvk_number, vat_id, invoice_email, payment_term_days, invoice_prefix)
    values (${randomUUID()}, ${input.tenantId}, ${input.legalName}, ${input.street}, ${input.houseNumber}, ${input.postalCode}, ${input.city}, ${input.countryCode.toUpperCase()}, ${input.kvkNumber}, ${input.vatId}, ${input.invoiceEmail}, ${input.paymentTermDays}, ${input.invoicePrefix.toUpperCase()})
    on conflict (tenant_id) do update set legal_name = excluded.legal_name, street = excluded.street, house_number = excluded.house_number, postal_code = excluded.postal_code, city = excluded.city, country_code = excluded.country_code, kvk_number = excluded.kvk_number, vat_id = excluded.vat_id, invoice_email = excluded.invoice_email, payment_term_days = excluded.payment_term_days, invoice_prefix = excluded.invoice_prefix, updated_at = now()
  `);
}
