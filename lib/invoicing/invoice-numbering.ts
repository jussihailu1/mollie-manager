import { sql } from "drizzle-orm";

import { getDb, type DbClient } from "@/lib/db";
import { formatKifyInvoiceNumber } from "@/lib/invoicing/invoice-number-format";

export { formatKifyInvoiceNumber } from "@/lib/invoicing/invoice-number-format";

type AllocatedSequenceRow = { allocatedValue: number };

export async function allocateKifyInvoiceNumber(input: {
  client?: DbClient;
  mode: "live" | "test";
  prefix: string;
  tenantId: string;
  year: number;
}) {
  const db = input.client ?? getDb();
  const prefix = input.prefix.trim();
  formatKifyInvoiceNumber({ mode: input.mode, prefix, sequence: 1, year: input.year });

  const result = await db.execute<AllocatedSequenceRow>(sql`
    insert into tenant_invoice_sequences (
      id, tenant_id, mode, year, prefix, next_value, created_at, updated_at
    ) values (
      ${`${input.tenantId}:${input.mode}:${input.year}:${prefix}`},
      ${input.tenantId},
      ${input.mode}::mollie_mode,
      ${input.year},
      ${prefix},
      2,
      now(),
      now()
    )
    on conflict (tenant_id, mode, year, prefix)
    do update set next_value = tenant_invoice_sequences.next_value + 1, updated_at = now()
    returning next_value - 1 as "allocatedValue"
  `);
  const allocatedValue = result.rows[0]?.allocatedValue;
  if (!allocatedValue) {
    throw new Error("Invoice sequence allocation did not return a value.");
  }

  return {
    number: formatKifyInvoiceNumber({
      mode: input.mode,
      prefix,
      sequence: allocatedValue,
      year: input.year,
    }),
    sequence: allocatedValue,
  };
}
