import { sql } from "drizzle-orm";

import type { MollieMode } from "@/lib/env";

function buildRecurringBaseFilters(mode: MollieMode, state: "pending_invoice" | "invoice_failed") {
  return sql.join(
    [
      sql`rbs.mode = ${mode}`,
      sql`rbs.invoice_state = ${state}`,
      sql`rbs.eboekhouden_invoice_id is null`,
      sql`rbs.eboekhouden_invoice_number is null`,
    ],
    sql` and `,
  );
}

export function buildRecurringDueInvoiceFilter(mode: MollieMode) {
  return sql.join(
    [
      buildRecurringBaseFilters(mode, "pending_invoice"),
      sql`rbs.invoice_send_due_date <= current_date`,
    ],
    sql` and `,
  );
}

export function buildRecurringFailedInvoiceFilter(mode: MollieMode) {
  return buildRecurringBaseFilters(mode, "invoice_failed");
}
