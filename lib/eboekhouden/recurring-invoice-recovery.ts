import { sql } from "drizzle-orm";

import { writeAuditLog } from "@/lib/audit";
import { getDb } from "@/lib/db";
import type { EboekhoudenInvoice } from "@/lib/eboekhouden/client";
import { buildRecurringFailedInvoiceFilter } from "@/lib/eboekhouden/recurring-invoice-query";
import { notificationsAreConfigured } from "@/lib/notifications/email";
import { deliverAlertEmail, openAlert } from "@/lib/reliability/alerts";
import { getSingleTenantIdOrThrow } from "@/lib/tenants";

export type RecurringInvoiceActor = {
  email?: string | null;
  kind: "system" | "user";
};

export type RecurringInvoiceRecoveryCandidate = {
  customerEmail: string;
  customerId: string;
  eboekhoudenRelationId: number;
  invoiceSendDueDate: string;
  mode: "live" | "test";
  plannedCollectionDate: string;
  scheduleId: string;
  subscriptionId: string;
};

export async function listFailedRecurringRecoveryCandidates(
  mode: "live" | "test",
  limit: number,
  tenantId?: string,
) {
  const resolvedTenantId = tenantId ?? (await getSingleTenantIdOrThrow());
  const result = await getDb().execute<RecurringInvoiceRecoveryCandidate>(sql`
    select
      rbs.id as "scheduleId",
      rbs.mode,
      rbs.invoice_send_due_date::text as "invoiceSendDueDate",
      rbs.planned_collection_date::text as "plannedCollectionDate",
      rbs.subscription_id as "subscriptionId",
      s.customer_id as "customerId",
      c.email as "customerEmail",
      c.eboekhouden_relation_id as "eboekhoudenRelationId"
    from recurring_billing_schedules rbs
    inner join subscriptions s
      on s.id = rbs.subscription_id
      and s.tenant_id = rbs.tenant_id
    inner join customers c
      on c.id = s.customer_id
      and c.mode = rbs.mode
      and c.tenant_id = rbs.tenant_id
    where rbs.tenant_id = ${resolvedTenantId}
      and ${buildRecurringFailedInvoiceFilter(mode, resolvedTenantId)}
      and c.eboekhouden_relation_id is not null
    order by rbs.updated_at asc, rbs.created_at asc
    limit ${Math.max(1, limit)}
  `);

  return result.rows;
}

export async function storeRecoveredFailedInvoiceSuccess(input: {
  actor: RecurringInvoiceActor;
  candidate: RecurringInvoiceRecoveryCandidate;
  invoice: EboekhoudenInvoice;
}) {
  const invoiceId = input.invoice.id ? String(input.invoice.id) : null;
  const invoiceNumber = input.invoice.invoiceNumber ?? input.invoice.number ?? null;
  const result = await getDb().execute<{ id: string }>(sql`
    update recurring_billing_schedules
    set
      invoice_state = 'invoice_created',
      eboekhouden_invoice_id = ${invoiceId},
      eboekhouden_invoice_number = ${invoiceNumber},
      invoice_created_at = coalesce(invoice_created_at, now()),
      invoice_failed_at = null,
      metadata = coalesce(metadata, '{}'::jsonb) || ${JSON.stringify({
        eboekhoudenInvoice: input.invoice,
        invoiceRecoveredAt: new Date().toISOString(),
        invoiceRecoverySource: "reconciled_existing",
      })}::jsonb,
      updated_at = now()
    where id = ${input.candidate.scheduleId}
      and invoice_state = 'invoice_failed'
      and eboekhouden_invoice_id is null
      and eboekhouden_invoice_number is null
    returning id
  `);

  if (!result.rows[0]?.id) {
    return null;
  }

  await writeAuditLog(
    {
      action: "recurring_invoice.recover_failed",
      details: {
        eboekhoudenInvoiceId: invoiceId,
        eboekhoudenInvoiceNumber: invoiceNumber,
        plannedCollectionDate: input.candidate.plannedCollectionDate,
        scheduleId: input.candidate.scheduleId,
        source: "reconciled_existing",
      },
      entityId: input.candidate.scheduleId,
      entityType: "recurring_billing_schedule",
      mode: input.candidate.mode,
      outcome: "success",
      summary:
        "Recovered failed recurring invoice row by reconciling existing e-Boekhouden invoice.",
    },
    undefined,
    input.actor,
  );

  const alertResult = await openAlert(
    {
      customerId: input.candidate.customerId,
      message:
        "Recovered failed recurring invoice row by reconciling existing e-Boekhouden invoice.",
      payload: {
        eboekhoudenInvoiceId: invoiceId,
        eboekhoudenInvoiceNumber: invoiceNumber,
        kind: "recurring_invoice_recovered",
        scheduleId: input.candidate.scheduleId,
        source: "reconciled_existing",
      },
      severity: "info",
      subscriptionId: input.candidate.subscriptionId,
      title: "Recurring invoice recovered",
    },
    undefined,
  );

  if (alertResult.isNew && notificationsAreConfigured()) {
    await deliverAlertEmail({
      alertId: alertResult.id,
      message: [
        "Recovered failed recurring invoice row.",
        "",
        `Customer email: ${input.candidate.customerEmail}`,
        `Schedule row: ${input.candidate.scheduleId}`,
        `Subscription: ${input.candidate.subscriptionId}`,
        `Error: reconciled existing invoice`,
      ].join("\n"),
      title: "Recurring invoice recovered",
    });
  }

  return {
    invoiceId,
    invoiceNumber,
  };
}
