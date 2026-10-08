import { sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import type { EboekhoudenInvoice } from "@/lib/eboekhouden/client";
import { openAlert } from "@/lib/reliability/alerts";

export async function recordFailedEboekhoudenInvoiceReview(input: {
  customerId: string | null;
  error: unknown;
  invoice: EboekhoudenInvoice;
  mode: "live" | "test";
  ownerId: string;
  ownerType: "payment" | "recurring_schedule";
  reference: string;
  subscriptionId: string | null;
  tenantId: string;
}) {
  const errorMessage = input.error instanceof Error ? input.error.message.slice(0, 500) : "Invoice verification failed.";
  const externalInvoice = {
    id: input.invoice.id ?? null,
    invoiceNumber: input.invoice.invoiceNumber ?? input.invoice.number ?? null,
    reference: input.reference,
  };
  const metadata = JSON.stringify({
    eboekhoudenUnverifiedInvoice: externalInvoice,
    invoiceCreationManualReview: true,
    invoiceRecoveryVerificationError: errorMessage,
  });
  if (input.ownerType === "payment") {
    await getDb().execute(sql`
      update payments
      set metadata = coalesce(metadata, '{}'::jsonb) || ${metadata}::jsonb, updated_at = now()
      where id = ${input.ownerId} and tenant_id = ${input.tenantId} and mode = ${input.mode} and invoice_state = 'invoice_failed'
    `);
  } else {
    await getDb().execute(sql`
      update recurring_billing_schedules
      set metadata = coalesce(metadata, '{}'::jsonb) || ${metadata}::jsonb, updated_at = now()
      where id = ${input.ownerId} and tenant_id = ${input.tenantId} and mode = ${input.mode} and invoice_state = 'invoice_failed'
    `);
  }

  await openAlert({
    customerId: input.customerId,
    message: `e-Boekhouden invoice ${externalInvoice.invoiceNumber ?? externalInvoice.id ?? "with unknown number"} exists but failed API amount, VAT, or identity verification: ${errorMessage}. Customer delivery is blocked. Follow documentation/operations/eboekhouden-invoice-recovery.md for this ${input.ownerType === "payment" ? "payment" : "schedule"}.`,
    paymentId: input.ownerType === "payment" ? input.ownerId : null,
    payload: {
      eboekhoudenInvoiceId: externalInvoice.id,
      eboekhoudenInvoiceNumber: externalInvoice.invoiceNumber,
      error: errorMessage,
      kind: "eboekhouden_invoice_verification_failed",
      mode: input.mode,
      ownerId: input.ownerId,
      ownerType: input.ownerType,
      reference: input.reference,
    },
    severity: "critical",
    subscriptionId: input.subscriptionId,
    tenantId: input.tenantId,
    title: `Unverified e-Boekhouden invoice (${input.ownerType}:${input.ownerId.slice(0, 8)})`,
  });
}
