import { sql } from "drizzle-orm";

import { writeAuditLog } from "@/lib/audit";
import { getDb, transaction } from "@/lib/db";
import type { EboekhoudenInvoice } from "@/lib/eboekhouden/client";
import { buildRecurringFailedInvoiceFilter } from "@/lib/eboekhouden/recurring-invoice-query";
import { saveStoredInvoice } from "@/lib/invoices";
import type { TaxTreatment } from "@/lib/invoicing/tax-treatment";
import { notificationsAreConfigured } from "@/lib/notifications/email";
import { deliverAlertEmail, openAlert } from "@/lib/reliability/alerts";

export type RecurringInvoiceActor = {
  email?: string | null;
  kind: "system" | "user";
};

export type RecurringInvoiceRecoveryCandidate = {
  amountValue: string;
  customerEmail: string;
  customerId: string;
  eboekhoudenRelationId: number;
  invoiceSendDueDate: string;
  mode: "live" | "test";
  plannedCollectionDate: string;
  scheduleId: string;
  subscriptionId: string;
  tenantId: string;
  taxTreatment: TaxTreatment | null;
};

export async function listFailedRecurringRecoveryCandidates(
  mode: "live" | "test",
  limit: number,
  tenantId?: string,
  scheduleId?: string,
) {
  if (!tenantId) {
    throw new Error("Tenant id is required.");
  }

  const resolvedTenantId = tenantId;
  const result = await getDb().execute<RecurringInvoiceRecoveryCandidate>(sql`
    select
      rbs.id as "scheduleId",
      rbs.mode,
      rbs.tenant_id as "tenantId",
      rbs.invoice_send_due_date::text as "invoiceSendDueDate",
      rbs.planned_collection_date::text as "plannedCollectionDate",
      rbs.amount_value::text as "amountValue",
      rbs.metadata ->> 'invoiceTaxTreatment' as "taxTreatment",
      rbs.subscription_id as "subscriptionId",
      s.customer_id as "customerId",
      c.email as "customerEmail",
      case
        when cal.provider_customer_id ~ '^[0-9]+$'
          then cal.provider_customer_id::int
        else null
      end as "eboekhoudenRelationId"
    from recurring_billing_schedules rbs
    inner join subscriptions s
      on s.id = rbs.subscription_id
      and s.tenant_id = rbs.tenant_id
    inner join customers c
      on c.id = s.customer_id
      and c.mode = rbs.mode
      and c.tenant_id = rbs.tenant_id
    left join customer_accounting_links cal
      on cal.customer_id = c.id
      and cal.tenant_id = c.tenant_id
      and cal.mode = c.mode
      and cal.provider = 'eboekhouden'
    where rbs.tenant_id = ${resolvedTenantId}
      and ${buildRecurringFailedInvoiceFilter(mode, resolvedTenantId)}
      and ${scheduleId ? sql`rbs.id = ${scheduleId}` : sql`true`}
      and cal.provider_customer_id is not null
    order by rbs.updated_at asc, rbs.created_at asc
    limit ${Math.max(1, limit)}
  `);

  return result.rows;
}

export async function storeRecoveredFailedInvoiceSuccess(input: {
  actor: RecurringInvoiceActor;
  candidate: RecurringInvoiceRecoveryCandidate;
  invoice: EboekhoudenInvoice;
  originalCreditNumber?: string;
}) {
  const invoiceId = input.invoice.id ? String(input.invoice.id) : null;
  const invoiceNumber = input.invoice.invoiceNumber ?? input.invoice.number ?? null;
  const recovered = await transaction(async (tx) => {
    const result = await tx.execute<{ id: string }>(sql`
    update recurring_billing_schedules
    set
      invoice_state = 'invoice_created',
      invoice_created_at = coalesce(invoice_created_at, now()),
      invoice_failed_at = null,
      metadata = coalesce(metadata, '{}'::jsonb) || ${JSON.stringify({
        eboekhoudenInvoice: input.invoice,
        eboekhoudenUnverifiedInvoice: null,
        invoiceCreationManualReview: false,
        invoiceRecoveredAt: new Date().toISOString(),
        invoiceRecoverySource: input.originalCreditNumber ? "manual_replacement" : "reconciled_existing",
        invoiceOriginalCreditNumber: input.originalCreditNumber ?? null,
      })}::jsonb,
      updated_at = now()
    where id = ${input.candidate.scheduleId}
      and tenant_id = ${input.candidate.tenantId}
      and mode = ${input.candidate.mode}
      and invoice_state = 'invoice_failed'
      and not exists (
        select 1
        from invoices i
        where i.tenant_id = recurring_billing_schedules.tenant_id
          and i.owner_type = 'recurring_schedule'
          and i.owner_id = recurring_billing_schedules.id
      )
    returning id
    `);
    if (!result.rows[0]?.id) return false;
    await saveStoredInvoice({
      mode: input.candidate.mode,
      ownerId: input.candidate.scheduleId,
      ownerType: "recurring_schedule",
      provider: "eboekhouden",
      providerCustomerId: String(input.candidate.eboekhoudenRelationId),
      providerDocumentUrl: input.invoice.urlPdfFile ?? null,
      providerInvoiceId: invoiceId,
      providerInvoiceNumber: invoiceNumber,
      providerSnapshot: input.invoice as Record<string, unknown>,
      syncedAt: new Date().toISOString(),
      tenantId: input.candidate.tenantId,
    }, tx);
    await tx.execute(sql`
      update alerts set status = 'resolved', resolved_at = now(), updated_at = now()
      where tenant_id = ${input.candidate.tenantId} and status = 'open'
        and (
          (payload ->> 'kind' = 'recurring_invoice_creation_failed' and payload ->> 'scheduleId' = ${input.candidate.scheduleId})
          or (payload ->> 'kind' = 'eboekhouden_invoice_verification_failed' and payload ->> 'ownerId' = ${input.candidate.scheduleId})
        )
    `);
    return true;
  });

  if (!recovered) return null;

  await writeAuditLog(
    {
      action: "recurring_invoice.recover_failed",
      details: {
        eboekhoudenInvoiceId: invoiceId,
        eboekhoudenInvoiceNumber: invoiceNumber,
        plannedCollectionDate: input.candidate.plannedCollectionDate,
        scheduleId: input.candidate.scheduleId,
        source: input.originalCreditNumber ? "manual_replacement" : "reconciled_existing",
        originalCreditNumber: input.originalCreditNumber ?? null,
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
      tenantId: input.candidate.tenantId,
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
      tenantId: input.candidate.tenantId,
      title: "Recurring invoice recovered",
    });
  }

  return {
    invoiceId,
    invoiceNumber,
  };
}
