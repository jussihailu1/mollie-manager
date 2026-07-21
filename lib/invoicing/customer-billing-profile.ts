import "server-only";

import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { validateCustomerBillingProfile, type CustomerBillingProfileInput } from "@/lib/invoicing/invoice-profile-validation";

export type CustomerBillingProfile = CustomerBillingProfileInput;

export async function getCustomerBillingProfile(input: { customerId: string; tenantId: string }) {
  const result = await getDb().execute<CustomerBillingProfile>(sql`
    select
      legal_name as "legalName",
      street,
      house_number as "houseNumber",
      postal_code as "postalCode",
      city,
      country_code as "countryCode",
      email
    from customer_billing_profiles
    where customer_id = ${input.customerId}
      and tenant_id = ${input.tenantId}
    limit 1
  `);

  return result.rows[0] ?? null;
}

export async function saveCustomerBillingProfile(input: CustomerBillingProfileInput & { customerId: string; tenantId: string }) {
  validateCustomerBillingProfile(input);
  const owned = await getDb().execute(sql`select id from customers where id = ${input.customerId} and tenant_id = ${input.tenantId} limit 1`);
  if (!owned.rows[0]) throw new Error("Customer is not available in the selected tenant.");
  await getDb().execute(sql`
    insert into customer_billing_profiles (id, tenant_id, customer_id, legal_name, street, house_number, postal_code, city, country_code, email)
    values (${randomUUID()}, ${input.tenantId}, ${input.customerId}, ${input.legalName}, ${input.street}, ${input.houseNumber}, ${input.postalCode}, ${input.city}, ${input.countryCode.toUpperCase()}, ${input.email})
    on conflict (tenant_id, customer_id) do update set legal_name = excluded.legal_name, street = excluded.street, house_number = excluded.house_number, postal_code = excluded.postal_code, city = excluded.city, country_code = excluded.country_code, email = excluded.email, updated_at = now()
  `);
}
