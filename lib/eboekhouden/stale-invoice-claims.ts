import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";

// Longer than the maximum function lifetime. Never replay a live claim and
// never reset an uncertain provider POST directly to the creation queue.
export async function recoverStaleInvoiceClaims(input: { tenantId: string; mode: "live" | "test"; ownerType: "payment" | "recurring_schedule" }) {
  const table = input.ownerType === "payment" ? sql`payments` : sql`recurring_billing_schedules`;
  return getDb().execute(sql`
    update ${table} as owner set invoice_state = 'invoice_failed', invoice_failed_at = now(), updated_at = now(),
      metadata = coalesce(owner.metadata, '{}'::jsonb) || '{"invoiceCreationStaleClaim":true,"invoiceCreationManualReview":true,"invoiceCreationError":"Interrupted invoice claim; reconciling provider before retry."}'::jsonb
    where owner.tenant_id = ${input.tenantId} and owner.mode = ${input.mode} and owner.invoice_state = 'invoice_creating'
      and coalesce(owner.metadata ->> 'invoiceCreationClaimedAt', owner.updated_at::text)::timestamptz < now() - interval '15 minutes'
      and not exists (select 1 from invoices i where i.tenant_id = owner.tenant_id and i.owner_type = ${input.ownerType}::invoice_owner_type and i.owner_id = owner.id)
  `);
}

// Called only after a complete, successful reference lookup returned no match.
// Creation performs the same lookup again and uses the same reference.
export async function requeueReconciledStaleInvoice(input: { tenantId: string; mode: "live" | "test"; ownerId: string; ownerType: "payment" | "recurring_schedule" }) {
  const table = input.ownerType === "payment" ? sql`payments` : sql`recurring_billing_schedules`;
  await getDb().execute(sql`
    update ${table} as owner set invoice_state = 'pending_invoice', invoice_failed_at = null, updated_at = now(),
      metadata = coalesce(owner.metadata, '{}'::jsonb) || jsonb_build_object('invoiceCreationStaleClaim', false, 'invoiceCreationManualReview', false, 'invoiceStaleClaimReconciledAt', now())
    where owner.id = ${input.ownerId} and owner.tenant_id = ${input.tenantId} and owner.mode = ${input.mode}
      and owner.invoice_state = 'invoice_failed' and owner.metadata ->> 'invoiceCreationStaleClaim' = 'true'
      and not exists (select 1 from invoices i where i.tenant_id = owner.tenant_id and i.owner_type = ${input.ownerType}::invoice_owner_type and i.owner_id = owner.id)
  `);
}
