import { sql } from "drizzle-orm";

import type { MollieMode } from "@/lib/env";

function buildRecurringBaseFilters(
  mode: MollieMode,
  state: "pending_invoice" | "invoice_failed",
  tenantId?: string,
) {
  const filters = [
    sql`rbs.mode = ${mode}`,
    sql`rbs.invoice_state = ${state}`,
    sql`rbs.eboekhouden_invoice_id is null`,
    sql`rbs.eboekhouden_invoice_number is null`,
  ];

  if (tenantId) {
    filters.push(sql`rbs.tenant_id = ${tenantId}`);
  }

  return sql.join(filters, sql` and `);
}

export function buildRecurringDueInvoiceFilter(mode: MollieMode, tenantId?: string) {
  return sql.join(
    [
      buildRecurringBaseFilters(mode, "pending_invoice", tenantId),
      sql`rbs.invoice_send_due_date <= current_date`,
    ],
    sql` and `,
  );
}

export function buildRecurringFailedInvoiceFilter(mode: MollieMode, tenantId?: string) {
  return buildRecurringBaseFilters(mode, "invoice_failed", tenantId);
}
