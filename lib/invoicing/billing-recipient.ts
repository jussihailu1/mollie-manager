import { sql } from "drizzle-orm";

// Queries using this expression join the tenant-owned customer as `c`.
// An explicit invoice-profile recipient takes precedence over the contact email.
export const customerBillingEmailSql = sql`coalesce((
  select nullif(trim(cbp.email), '') from customer_billing_profiles cbp
  where cbp.customer_id = c.id and cbp.tenant_id = c.tenant_id
), c.email)`;
