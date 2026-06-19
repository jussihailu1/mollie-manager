import "server-only";

import { sql } from "drizzle-orm";
import { cache } from "react";

import type { DashboardModeFilter } from "@/lib/dashboard-mode";
import { normalizeCustomerNoteBody } from "@/lib/customer-note-policy";
import { getDb } from "@/lib/db";

export { normalizeCustomerNoteBody };

export type CustomerNoteSource = "legacy_customer_notes" | "operator";

export type CustomerNote = {
  archivedAt: string | null;
  body: string;
  createdAt: string;
  customerId: string;
  id: string;
  mode: "live" | "test";
  source: CustomerNoteSource;
  updatedAt: string;
};

function toModeParam(mode?: DashboardModeFilter) {
  return !mode || mode === "all" ? null : mode;
}

const listCustomerNotesByMode = cache(async (
  customerId: string,
  mode: DashboardModeFilter,
  limit: number,
) => {
  const modeParam = toModeParam(mode);
  const normalizedLimit = Math.max(1, Math.min(Math.trunc(limit), 100));
  const result = await getDb().execute<CustomerNote>(sql`
    select
      cn.id,
      cn.mode,
      cn.customer_id as "customerId",
      cn.body,
      cn.source,
      cn.created_at as "createdAt",
      cn.updated_at as "updatedAt",
      cn.archived_at as "archivedAt"
    from customer_notes cn
    where cn.customer_id = ${customerId}
      and cn.archived_at is null
      and (${modeParam}::mollie_mode is null or cn.mode = ${modeParam})
    order by cn.created_at desc
    limit ${normalizedLimit}
  `);

  return result.rows;
});

export async function listCustomerNotes(options: {
  customerId: string;
  limit?: number;
  mode?: DashboardModeFilter;
}) {
  return listCustomerNotesByMode(
    options.customerId,
    options.mode ?? "all",
    options.limit ?? 20,
  );
}
