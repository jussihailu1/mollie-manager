import { sql } from "drizzle-orm";

import { writeAuditLog } from "@/lib/audit";
import { getDb, transaction } from "@/lib/db";
import type { EboekhoudenInvoice } from "@/lib/eboekhouden/client";
import {
  buildInvoiceCreationClaimMetadata,
  buildInvoiceCreationFailureMetadata,
  buildInvoiceCreationSuccessMetadata,
} from "@/lib/eboekhouden/invoice-creation-metadata";
import { serializeInvoiceErrorMessage } from "@/lib/eboekhouden/invoice-flow-helpers";
import { saveStoredInvoice } from "@/lib/invoices";
import { notificationsAreConfigured } from "@/lib/notifications/email";
import { deliverAlertEmail, openAlert } from "@/lib/reliability/alerts";

export type RecurringInvoiceActor = {
  email?: string | null;
  kind: "system" | "user";
};

export type RecurringInvoicePersistenceCandidate = {
  customerEmail: string;
  customerId: string;
  invoiceSendDueDate: string;
  mode: "live" | "test";
  plannedCollectionDate: string;
  scheduleId: string;
  subscriptionId: string;
  tenantId: string;
};

type AlertResult = {
  id: string;
  isNew: boolean;
};

function serializeRecurringInvoiceError(error: unknown) {
  return serializeInvoiceErrorMessage(error, "Recurring invoice creation failed.");
}

export async function claimScheduleForInvoice(input: {
  actor: RecurringInvoiceActor;
  mode: "live" | "test";
  scheduleId: string;
  tenantId: string;
}) {
  const result = await getDb().execute<{ id: string }>(sql`
    update recurring_billing_schedules
    set
      invoice_state = 'invoice_creating',
      invoice_failed_at = null,
      updated_at = now(),
      metadata = coalesce(metadata, '{}'::jsonb) || ${JSON.stringify(
        buildInvoiceCreationClaimMetadata({
          actorEmail: input.actor.email,
        }),
      )}::jsonb
    where id = ${input.scheduleId}
      and tenant_id = ${input.tenantId}
      and mode = ${input.mode}
      and invoice_state = 'pending_invoice'
      and not exists (
        select 1
        from invoices i
        where i.tenant_id = recurring_billing_schedules.tenant_id
          and i.owner_type = 'recurring_schedule'
          and i.owner_id = recurring_billing_schedules.id
      )
    returning id
  `);

  return result.rows[0]?.id ?? null;
}

export async function storeRecurringInvoiceCreationSuccess(input: {
  actor: RecurringInvoiceActor;
  candidate: RecurringInvoicePersistenceCandidate;
  invoice: EboekhoudenInvoice;
  source?: "created" | "reconciled_existing";
}) {
  const invoiceId = input.invoice.id ? String(input.invoice.id) : null;
  const invoiceNumber = input.invoice.invoiceNumber ?? input.invoice.number ?? null;
  const source = input.source ?? "created";
  const alertResult = await transaction<AlertResult>(async (tx) => {
    await tx.execute(sql`
      update recurring_billing_schedules
      set
        invoice_state = 'invoice_created',
        invoice_created_at = now(),
        invoice_failed_at = null,
        metadata = coalesce(metadata, '{}'::jsonb) || ${JSON.stringify(
          buildInvoiceCreationSuccessMetadata({ invoice: input.invoice }),
        )}::jsonb,
        updated_at = now()
      where id = ${input.candidate.scheduleId}
        and tenant_id = ${input.candidate.tenantId}
        and invoice_state = 'invoice_creating'
    `);

    await saveStoredInvoice(
      {
        mode: input.candidate.mode,
        ownerId: input.candidate.scheduleId,
        ownerType: "recurring_schedule",
        provider: "eboekhouden",
        providerCustomerId: null,
        providerDocumentUrl: input.invoice.urlPdfFile ?? null,
        providerInvoiceId: invoiceId,
        providerInvoiceNumber: invoiceNumber,
        providerSnapshot: input.invoice as Record<string, unknown>,
        syncedAt: new Date().toISOString(),
        tenantId: input.candidate.tenantId,
      },
      tx,
    );

    await writeAuditLog(
      {
        action: "recurring_invoice.create",
        details: {
          eboekhoudenInvoiceId: invoiceId,
          eboekhoudenInvoiceNumber: invoiceNumber,
          plannedCollectionDate: input.candidate.plannedCollectionDate,
          scheduleId: input.candidate.scheduleId,
          source,
          subscriptionId: input.candidate.subscriptionId,
        },
        entityId: input.candidate.scheduleId,
        entityType: "recurring_billing_schedule",
        mode: input.candidate.mode,
        outcome: "success",
        summary:
          source === "created"
            ? "Created an e-Boekhouden recurring invoice for a due schedule row."
            : "Recovered an existing e-Boekhouden recurring invoice for a due schedule row.",
      },
      tx,
      input.actor,
    );

    await tx.execute(sql`
      update alerts
      set
        status = 'resolved',
        resolved_at = now(),
        updated_at = now()
      where status = 'open'
        and payload ->> 'kind' = 'recurring_invoice_creation_failed'
        and payload ->> 'scheduleId' = ${input.candidate.scheduleId}
        and payload ->> 'tenantId' = ${input.candidate.tenantId}
    `);

    return openAlert(
      {
        customerId: input.candidate.customerId,
        message:
          source === "created"
            ? `Created e-Boekhouden invoice ${invoiceNumber ?? invoiceId ?? "without returned number"} for the recurring billing row due on ${input.candidate.invoiceSendDueDate}. Automatic collection remains planned for ${input.candidate.plannedCollectionDate}.`
            : `Recovered existing e-Boekhouden invoice ${invoiceNumber ?? invoiceId ?? "without returned number"} for recurring billing row due on ${input.candidate.invoiceSendDueDate}. Automatic collection remains planned for ${input.candidate.plannedCollectionDate}.`,
        payload: {
          eboekhoudenInvoiceId: invoiceId,
          eboekhoudenInvoiceNumber: invoiceNumber,
          kind: "recurring_invoice_created",
          mode: input.candidate.mode,
          plannedCollectionDate: input.candidate.plannedCollectionDate,
          scheduleId: input.candidate.scheduleId,
          source,
        },
        severity: "info",
        subscriptionId: input.candidate.subscriptionId,
        tenantId: input.candidate.tenantId,
        title:
          source === "created"
            ? `Recurring invoice created for ${input.candidate.plannedCollectionDate}`
            : `Recurring invoice recovered for ${input.candidate.plannedCollectionDate}`,
      },
      tx,
    );
  });

  return {
    alert: alertResult,
    invoiceId,
    invoiceNumber,
  };
}

export async function storeRecurringInvoiceCreationFailure(input: {
  actor: RecurringInvoiceActor;
  candidate: RecurringInvoicePersistenceCandidate;
  error: unknown;
}) {
  const errorMessage = serializeRecurringInvoiceError(input.error);
  const alertResult = await transaction<AlertResult>(async (tx) => {
    await tx.execute(sql`
      update recurring_billing_schedules
      set
        invoice_state = 'invoice_failed',
        invoice_failed_at = now(),
        metadata = coalesce(metadata, '{}'::jsonb) || ${JSON.stringify(
          buildInvoiceCreationFailureMetadata({ errorMessage }),
        )}::jsonb,
        updated_at = now()
      where id = ${input.candidate.scheduleId}
        and tenant_id = ${input.candidate.tenantId}
        and invoice_state = 'invoice_creating'
    `);

    await writeAuditLog(
      {
        action: "recurring_invoice.create",
        details: {
          error: errorMessage,
          plannedCollectionDate: input.candidate.plannedCollectionDate,
          scheduleId: input.candidate.scheduleId,
          subscriptionId: input.candidate.subscriptionId,
        },
        entityId: input.candidate.scheduleId,
        entityType: "recurring_billing_schedule",
        mode: input.candidate.mode,
        outcome: "failure",
        summary: "Recurring invoice creation failed for a due schedule row.",
      },
      tx,
      input.actor,
    );

    return openAlert(
      {
        customerId: input.candidate.customerId,
        message: `Could not create the recurring e-Boekhouden invoice for ${input.candidate.plannedCollectionDate}. Review the schedule row before retrying so a duplicate invoice is not created upstream.`,
        payload: {
          error: errorMessage,
          kind: "recurring_invoice_creation_failed",
          mode: input.candidate.mode,
          plannedCollectionDate: input.candidate.plannedCollectionDate,
          scheduleId: input.candidate.scheduleId,
        },
        severity: "warning",
        subscriptionId: input.candidate.subscriptionId,
        tenantId: input.candidate.tenantId,
        title: `Recurring invoice creation failed for ${input.candidate.plannedCollectionDate}`,
      },
      tx,
    );
  });

  if (alertResult.isNew && notificationsAreConfigured()) {
    await deliverAlertEmail({
      alertId: alertResult.id,
      message: [
        "Recurring e-Boekhouden invoice creation failed.",
        "",
        `Customer email: ${input.candidate.customerEmail}`,
        `Subscription: ${input.candidate.subscriptionId}`,
        `Schedule row: ${input.candidate.scheduleId}`,
        `Planned collection date: ${input.candidate.plannedCollectionDate}`,
        `Error: ${errorMessage}`,
      ].join("\n"),
      tenantId: input.candidate.tenantId,
      title: "Recurring invoice creation failed",
    });
  }

  return errorMessage;
}
