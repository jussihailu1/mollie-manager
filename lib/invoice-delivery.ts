import "server-only";

import { sql } from "drizzle-orm";

import { writeAuditLog } from "@/lib/audit";
import { getDb, transaction } from "@/lib/db";
import type { MollieMode } from "@/lib/env";
import { env } from "@/lib/env";
import { getSingleTenantIdOrThrow } from "@/lib/tenants";
import { getEboekhoudenInvoice } from "@/lib/eboekhouden/client";
import {
  getNextRetryAtIso,
  MAX_DELIVERY_ATTEMPTS,
  toInvoiceDeliveryAttemptCount,
} from "@/lib/invoice-delivery-retry";
import {
  buildTrustedInvoicePdfAttachment,
  normalizeTrustedInvoicePdfUrl,
} from "@/lib/invoice-pdf";
import { retryInvoiceDeliveryEmailsBatchWithDependencies } from "@/lib/invoice-delivery-batch";
import { sendEmailTo } from "@/lib/notifications/email";
import { deliverAlertEmail, openAlert } from "@/lib/reliability/alerts";

type InvoiceActor = {
  email?: string | null;
  kind: "system" | "user";
};

type DeliveryInput = {
  actor: InvoiceActor;
  customerEmail: string | null;
  customerId: string | null;
  eboekhoudenInvoiceId: string | null;
  eboekhoudenInvoiceNumber: string | null;
  eboekhoudenInvoicePdfUrl?: string | null;
  entityId: string;
  invoiceType: "first_payment" | "recurring";
  mode: MollieMode;
  plannedCollectionDate?: string | null;
  subscriptionId: string | null;
};

type RetryDeliveryCandidate = Omit<DeliveryInput, "actor">;

type InvoiceDeliveryBatchResult = {
  attemptedCount: number;
  failedCount: number;
  sentCount: number;
  skippedCount: number;
};

export type InvoiceDeliveryQueueSummary = {
  dueRetryFirstPaymentCount: number;
  dueRetryRecurringCount: number;
  permanentFailureFirstPaymentCount: number;
  permanentFailureRecurringCount: number;
};

async function resolveTenantId(tenantId?: string) {
  return tenantId ?? (await getSingleTenantIdOrThrow());
}

type FirstPaymentDeliveryCandidate = {
  customerEmail: string | null;
  customerId: string | null;
  eboekhoudenInvoiceId: string | null;
  eboekhoudenInvoiceNumber: string | null;
  metadata: Record<string, unknown>;
  mode: MollieMode;
  paymentId: string;
  subscriptionId: string | null;
};

type RecurringDeliveryCandidate = {
  customerEmail: string | null;
  customerId: string | null;
  eboekhoudenInvoiceId: string | null;
  eboekhoudenInvoiceNumber: string | null;
  metadata: Record<string, unknown>;
  mode: MollieMode;
  plannedCollectionDate: string;
  scheduleId: string;
  subscriptionId: string | null;
};

function serializeErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message.slice(0, 500);
  }

  return "Invoice email delivery failed.";
}

function buildEmailContent(input: {
  invoicePdfUrl: string | null;
  invoiceNumber: string;
  invoiceType: "first_payment" | "recurring";
  plannedCollectionDate?: string | null;
}) {
  const invoicePortalUrl =
    input.invoiceType === "first_payment"
      ? `${env.APP_URL}/payments`
      : `${env.APP_URL}/customers`;
  const documentLine = input.invoicePdfUrl
    ? `Factuurdocument: ${input.invoicePdfUrl}`
    : `Factuurdocument: ${invoicePortalUrl}`;

  if (input.invoiceType === "first_payment") {
    return {
      subject: `Factuur ${input.invoiceNumber} voor je eerste betaling`,
      text: [
        "Beste klant,",
        "",
        `Je factuur ${input.invoiceNumber} voor de eerste betaling is aangemaakt.`,
        "Deze factuur hoort bij de al betaalde eerste termijn.",
        documentLine,
        "",
        "Vragen? Neem gerust contact op.",
      ].join("\n"),
    };
  }

  return {
    subject: `Factuur ${input.invoiceNumber} voorafgaand aan automatische incasso`,
      text: [
        "Beste klant,",
        "",
        `Je factuur ${input.invoiceNumber} is aangemaakt.`,
        input.plannedCollectionDate
          ? `De automatische incasso staat gepland op ${input.plannedCollectionDate}.`
          : "De automatische incasso volgt volgens je abonnement.",
        documentLine,
        "",
        "Vragen? Neem gerust contact op.",
      ].join("\n"),
  };
}

function deliveryFailureAlertTitle(input: {
  entityId: string;
  invoiceType: "first_payment" | "recurring";
  kind: "failed" | "permanent";
}) {
  const prefix = input.kind === "permanent"
    ? "Invoice delivery permanently failed"
    : "Invoice delivery failed";
  const entityLabel = input.invoiceType === "first_payment" ? "payment" : "schedule";
  return `${prefix} (${entityLabel}:${input.entityId.slice(0, 8)})`;
}

async function resolveInvoicePdfUrl(input: {
  eboekhoudenInvoiceId: string | null;
  eboekhoudenInvoicePdfUrl?: string | null;
}) {
  const trustedMetadataUrl = normalizeTrustedInvoicePdfUrl(
    input.eboekhoudenInvoicePdfUrl,
  );
  if (trustedMetadataUrl) {
    return trustedMetadataUrl;
  }

  if (!input.eboekhoudenInvoiceId) {
    return null;
  }

  const numericInvoiceId = Number(input.eboekhoudenInvoiceId);
  if (!Number.isInteger(numericInvoiceId) || numericInvoiceId <= 0) {
    return null;
  }

  const invoice = await getEboekhoudenInvoice(numericInvoiceId);
  return normalizeTrustedInvoicePdfUrl(invoice.urlPdfFile ?? null);
}

async function storeDeliverySuccess(input: {
  actor: InvoiceActor;
  deliveryRecipient: string;
  entityId: string;
  intendedRecipient: string;
  invoiceType: "first_payment" | "recurring";
  metadata: Record<string, unknown>;
  mode: MollieMode;
  recipientOverridden: boolean;
}) {
  if (input.invoiceType === "first_payment") {
    await getDb().execute(sql`
      update payments
      set
        invoice_state = 'invoice_sent',
        invoice_sent_at = now(),
        metadata = coalesce(metadata, '{}'::jsonb) || ${JSON.stringify(input.metadata)}::jsonb,
        updated_at = now()
      where id = ${input.entityId}
        and invoice_state in ('invoice_created', 'invoice_sent')
    `);
  } else {
    await getDb().execute(sql`
      update recurring_billing_schedules
      set
        invoice_state = 'invoice_sent',
        invoice_sent_at = now(),
        metadata = coalesce(metadata, '{}'::jsonb) || ${JSON.stringify(input.metadata)}::jsonb,
        updated_at = now()
      where id = ${input.entityId}
        and invoice_state in ('invoice_created', 'invoice_sent')
    `);
  }

  await getDb().execute(sql`
    update alerts
    set
      status = 'resolved',
      resolved_at = now(),
      updated_at = now()
    where status = 'open'
      and payload ->> 'kind' in ('invoice_delivery_failed', 'invoice_delivery_permanent_failure')
      and payload ->> 'entityId' = ${input.entityId}
  `);

  await writeAuditLog(
    {
      action: "invoice.delivery",
      details: {
        deliveryRecipient: input.deliveryRecipient,
        intendedRecipient: input.intendedRecipient,
        invoiceType: input.invoiceType,
        recipientOverridden: input.recipientOverridden,
      },
      entityId: input.entityId,
      entityType:
        input.invoiceType === "first_payment"
          ? "payment"
          : "recurring_billing_schedule",
      mode: input.mode,
      outcome: "success",
      summary: "Delivered invoice email from app SMTP.",
    },
    undefined,
    input.actor,
  );
}

async function getInvoiceEntityMetadata(input: {
  entityId: string;
  invoiceType: "first_payment" | "recurring";
}) {
  if (input.invoiceType === "first_payment") {
    const result = await getDb().execute<{ metadata: Record<string, unknown> }>(sql`
      select metadata
      from payments
      where id = ${input.entityId}
      limit 1
    `);
    return result.rows[0]?.metadata ?? null;
  }

  const result = await getDb().execute<{ metadata: Record<string, unknown> }>(sql`
    select metadata
    from recurring_billing_schedules
    where id = ${input.entityId}
    limit 1
  `);
  return result.rows[0]?.metadata ?? null;
}

async function storeDeliveryFailure(input: DeliveryInput & { errorMessage: string }) {
  const deliveryRecipient = env.INVOICE_EMAIL_OVERRIDE_TO ?? input.customerEmail;
  const currentMetadata =
    (await getInvoiceEntityMetadata({
      entityId: input.entityId,
      invoiceType: input.invoiceType,
    })) ?? {};
  const attemptCount = toInvoiceDeliveryAttemptCount(currentMetadata) + 1;
  const nextRetryAt =
    attemptCount >= MAX_DELIVERY_ATTEMPTS ? null : getNextRetryAtIso(attemptCount);
  const payload = {
    invoiceDeliveryAttemptCount: attemptCount,
    invoiceDeliveryEffectiveRecipient: deliveryRecipient,
    invoiceDeliveryAttemptedAt: new Date().toISOString(),
    invoiceDeliveryError: input.errorMessage,
    invoiceDeliveryIntendedRecipient: input.customerEmail,
    invoiceDeliveryNextRetryAt: nextRetryAt,
    invoiceDeliveryPermanentFailure:
      attemptCount >= MAX_DELIVERY_ATTEMPTS ? true : false,
    invoiceDeliveryRecipientOverridden: env.INVOICE_EMAIL_OVERRIDE_TO ? true : false,
    invoiceDeliveryStatus: "failed",
  };

  if (input.invoiceType === "first_payment") {
    await getDb().execute(sql`
      update payments
      set
        metadata = coalesce(metadata, '{}'::jsonb) || ${JSON.stringify(payload)}::jsonb,
        updated_at = now()
      where id = ${input.entityId}
        and invoice_state in ('invoice_created', 'invoice_sent')
    `);
  } else {
    await getDb().execute(sql`
      update recurring_billing_schedules
      set
        metadata = coalesce(metadata, '{}'::jsonb) || ${JSON.stringify(payload)}::jsonb,
        updated_at = now()
      where id = ${input.entityId}
        and invoice_state in ('invoice_created', 'invoice_sent')
    `);
  }

  const alert = await transaction(async (tx) =>
    openAlert(
      {
        customerId: input.customerId,
        message:
          "Factuur is aangemaakt in e-Boekhouden, maar app-mail levering faalde. Factuur blijft aangemaakt; controleer mailinstellingen en probeer levering opnieuw.",
        paymentId: input.invoiceType === "first_payment" ? input.entityId : null,
        payload: {
          entityId: input.entityId,
          error: input.errorMessage,
          kind: "invoice_delivery_failed",
          mode: input.mode,
          originalRecipient: input.customerEmail,
          overrideRecipient: env.INVOICE_EMAIL_OVERRIDE_TO ?? null,
        },
        severity: "warning",
        subscriptionId: input.subscriptionId,
        title: deliveryFailureAlertTitle({
          entityId: input.entityId,
          invoiceType: input.invoiceType,
          kind: "failed",
        }),
      },
      tx,
    ),
  );

  await writeAuditLog(
    {
      action: "invoice.delivery",
      details: {
        effectiveRecipient: deliveryRecipient,
        error: input.errorMessage,
        invoiceType: input.invoiceType,
        intendedRecipient: input.customerEmail,
        recipientOverridden: env.INVOICE_EMAIL_OVERRIDE_TO ? true : false,
      },
      entityId: input.entityId,
      entityType:
        input.invoiceType === "first_payment"
          ? "payment"
          : "recurring_billing_schedule",
      mode: input.mode,
      outcome: "failure",
      summary: "Invoice email delivery failed after invoice creation.",
    },
    undefined,
    input.actor,
  );

  if (alert.isNew) {
    await deliverAlertEmail({
      alertId: alert.id,
      message: [
        "Invoice email delivery failed after invoice creation.",
        "",
        `Entity: ${input.entityId}`,
        `Original recipient: ${input.customerEmail ?? "unknown"}`,
        `Override recipient: ${env.INVOICE_EMAIL_OVERRIDE_TO ?? "none"}`,
        `Error: ${input.errorMessage}`,
      ].join("\n"),
      title: deliveryFailureAlertTitle({
        entityId: input.entityId,
        invoiceType: input.invoiceType,
        kind: "failed",
      }),
    });
  }

  if (attemptCount >= MAX_DELIVERY_ATTEMPTS) {
    const permanentAlert = await transaction(async (tx) =>
      openAlert(
        {
          customerId: input.customerId,
          message:
            "Factuurmail heeft maximaal aantal retries bereikt en is nu permanent gefaald. Handmatige opvolging nodig.",
          paymentId: input.invoiceType === "first_payment" ? input.entityId : null,
          payload: {
            attemptCount,
            entityId: input.entityId,
            error: input.errorMessage,
            kind: "invoice_delivery_permanent_failure",
            mode: input.mode,
            originalRecipient: input.customerEmail,
            overrideRecipient: env.INVOICE_EMAIL_OVERRIDE_TO ?? null,
          },
          severity: "critical",
          subscriptionId: input.subscriptionId,
          title: deliveryFailureAlertTitle({
            entityId: input.entityId,
            invoiceType: input.invoiceType,
            kind: "permanent",
          }),
        },
        tx,
      ),
    );

    if (permanentAlert.isNew) {
      await deliverAlertEmail({
        alertId: permanentAlert.id,
        message: [
          "Invoice delivery reached max retry attempts and is now permanent failure.",
          "",
          `Entity: ${input.entityId}`,
          `Attempt count: ${attemptCount}`,
          `Original recipient: ${input.customerEmail ?? "unknown"}`,
        `Override recipient: ${env.INVOICE_EMAIL_OVERRIDE_TO ?? "none"}`,
        `Error: ${input.errorMessage}`,
      ].join("\n"),
        title: deliveryFailureAlertTitle({
          entityId: input.entityId,
          invoiceType: input.invoiceType,
          kind: "permanent",
        }),
      });
    }
  }
}

export async function deliverCustomerInvoiceEmail(input: DeliveryInput) {
  if (!input.customerEmail) {
    return {
      reason: "Customer email missing.",
      status: "skipped" as const,
    };
  }

  const invoiceNumber =
    input.eboekhoudenInvoiceNumber ?? input.eboekhoudenInvoiceId ?? null;
  if (!invoiceNumber) {
    return {
      reason: "Invoice identifier missing.",
      status: "skipped" as const,
    };
  }

  const invoicePdfUrl = await resolveInvoicePdfUrl({
    eboekhoudenInvoiceId: input.eboekhoudenInvoiceId,
    eboekhoudenInvoicePdfUrl: input.eboekhoudenInvoicePdfUrl,
  });
  const attachmentResult = await buildTrustedInvoicePdfAttachment({
    invoiceNumber,
    invoicePdfUrl,
  });
  const finalRecipient = env.INVOICE_EMAIL_OVERRIDE_TO ?? input.customerEmail;
  const content = buildEmailContent({
    invoicePdfUrl: attachmentResult.trustedInvoicePdfUrl,
    invoiceNumber,
    invoiceType: input.invoiceType,
    plannedCollectionDate: input.plannedCollectionDate,
  });

  try {
    await sendEmailTo({
      attachments: attachmentResult.attachment
        ? [attachmentResult.attachment]
        : undefined,
      subject: content.subject,
      text: content.text,
      to: finalRecipient,
    });

    await storeDeliverySuccess({
      actor: input.actor,
      deliveryRecipient: finalRecipient,
      entityId: input.entityId,
      intendedRecipient: input.customerEmail,
      invoiceType: input.invoiceType,
      metadata: {
        invoiceDeliveryAttemptedAt: new Date().toISOString(),
        invoiceDeliveryAttemptCount: 0,
        invoiceDeliveryNextRetryAt: null,
        invoiceDeliveryPermanentFailure: false,
        invoiceDeliveryRecipient: finalRecipient,
        invoiceDocumentAttached: attachmentResult.attachment ? true : false,
        invoiceDocumentAttachmentStatus: attachmentResult.attachmentStatus,
        invoiceDocumentUrl: attachmentResult.trustedInvoicePdfUrl,
        invoiceDeliveryStatus: "sent",
        invoiceIntendedRecipient: input.customerEmail,
        invoiceRecipientOverridden: env.INVOICE_EMAIL_OVERRIDE_TO ? true : false,
      },
      mode: input.mode,
      recipientOverridden: env.INVOICE_EMAIL_OVERRIDE_TO ? true : false,
    });

    return { status: "sent" as const };
  } catch (error) {
    const errorMessage = serializeErrorMessage(error);
    await storeDeliveryFailure({
      ...input,
      errorMessage,
    });

    return {
      reason: errorMessage,
      status: "failed" as const,
    };
  }
}


async function listCreatedUnsentFirstPaymentInvoiceDeliveries(
  mode: MollieMode,
  limit: number,
) {
  const result = await getDb().execute<FirstPaymentDeliveryCandidate>(sql`
    select
      p.id as "paymentId",
      p.mode,
      p.customer_id as "customerId",
      p.subscription_id as "subscriptionId",
      p.eboekhouden_invoice_id as "eboekhoudenInvoiceId",
      p.eboekhouden_invoice_number as "eboekhoudenInvoiceNumber",
      p.metadata,
      c.email as "customerEmail"
    from payments p
    left join customers c on c.id = p.customer_id and c.mode = p.mode
    where p.mode = ${mode}
      and p.payment_type = 'first'
      and p.invoice_state = 'invoice_created'
      and p.invoice_sent_at is null
      and (p.eboekhouden_invoice_id is not null or p.eboekhouden_invoice_number is not null)
      and (
        case
          when lower(coalesce(p.metadata ->> 'invoiceDeliveryPermanentFailure', '')) in ('true', 'false')
          then (p.metadata ->> 'invoiceDeliveryPermanentFailure')::boolean
          else false
        end
      ) = false
      and (
        case
          when coalesce(p.metadata ->> 'invoiceDeliveryAttemptCount', '') ~ '^[0-9]+$'
          then (p.metadata ->> 'invoiceDeliveryAttemptCount')::int
          else 0
        end
      ) < ${MAX_DELIVERY_ATTEMPTS}
      and (
        case
          when coalesce(p.metadata ->> 'invoiceDeliveryNextRetryAt', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
          then (p.metadata ->> 'invoiceDeliveryNextRetryAt')::timestamptz
          else to_timestamp(0)
        end
      ) <= now()
    order by p.invoice_created_at asc nulls last, p.created_at asc
    limit ${Math.max(1, limit)}
  `);

  return result.rows.map<RetryDeliveryCandidate>((row) => ({
    customerEmail: row.customerEmail,
    customerId: row.customerId,
    eboekhoudenInvoiceId: row.eboekhoudenInvoiceId,
    eboekhoudenInvoiceNumber: row.eboekhoudenInvoiceNumber,
    mode: row.mode,
    plannedCollectionDate: null,
    entityId: row.paymentId,
    invoiceType: "first_payment",
    subscriptionId: row.subscriptionId,
  }));
}

async function listCreatedUnsentRecurringInvoiceDeliveries(
  mode: MollieMode,
  limit: number,
) {
  const result = await getDb().execute<RecurringDeliveryCandidate>(sql`
    select
      rbs.id as "scheduleId",
      rbs.mode,
      rbs.subscription_id as "subscriptionId",
      rbs.planned_collection_date::text as "plannedCollectionDate",
      rbs.eboekhouden_invoice_id as "eboekhoudenInvoiceId",
      rbs.eboekhouden_invoice_number as "eboekhoudenInvoiceNumber",
      rbs.metadata,
      s.customer_id as "customerId",
      c.email as "customerEmail"
    from recurring_billing_schedules rbs
    inner join subscriptions s on s.id = rbs.subscription_id
    inner join customers c on c.id = s.customer_id and c.mode = rbs.mode
    where rbs.mode = ${mode}
      and rbs.invoice_state = 'invoice_created'
      and rbs.invoice_sent_at is null
      and (rbs.eboekhouden_invoice_id is not null or rbs.eboekhouden_invoice_number is not null)
      and (
        case
          when lower(coalesce(rbs.metadata ->> 'invoiceDeliveryPermanentFailure', '')) in ('true', 'false')
          then (rbs.metadata ->> 'invoiceDeliveryPermanentFailure')::boolean
          else false
        end
      ) = false
      and (
        case
          when coalesce(rbs.metadata ->> 'invoiceDeliveryAttemptCount', '') ~ '^[0-9]+$'
          then (rbs.metadata ->> 'invoiceDeliveryAttemptCount')::int
          else 0
        end
      ) < ${MAX_DELIVERY_ATTEMPTS}
      and (
        case
          when coalesce(rbs.metadata ->> 'invoiceDeliveryNextRetryAt', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
          then (rbs.metadata ->> 'invoiceDeliveryNextRetryAt')::timestamptz
          else to_timestamp(0)
        end
      ) <= now()
    order by rbs.invoice_created_at asc nulls last, rbs.created_at asc
    limit ${Math.max(1, limit)}
  `);

  return result.rows.map<RetryDeliveryCandidate>((row) => ({
    customerEmail: row.customerEmail,
    customerId: row.customerId,
    eboekhoudenInvoiceId: row.eboekhoudenInvoiceId,
    eboekhoudenInvoiceNumber: row.eboekhoudenInvoiceNumber,
    mode: row.mode,
    plannedCollectionDate: row.plannedCollectionDate,
    entityId: row.scheduleId,
    invoiceType: "recurring",
    subscriptionId: row.subscriptionId,
  }));
}

export async function retryUnsentFirstPaymentInvoiceEmailsBatch(input: {
  actor: InvoiceActor;
  limit?: number;
  mode: MollieMode;
}): Promise<InvoiceDeliveryBatchResult> {
  return retryInvoiceDeliveryEmailsBatchWithDependencies(input, {
    deliverCustomerInvoiceEmail,
    loadCandidates: listCreatedUnsentFirstPaymentInvoiceDeliveries,
  });
}

export async function retryUnsentRecurringInvoiceEmailsBatch(input: {
  actor: InvoiceActor;
  limit?: number;
  mode: MollieMode;
}): Promise<InvoiceDeliveryBatchResult> {
  return retryInvoiceDeliveryEmailsBatchWithDependencies(input, {
    deliverCustomerInvoiceEmail,
    loadCandidates: listCreatedUnsentRecurringInvoiceDeliveries,
  });
}

export async function getInvoiceDeliveryQueueSummary(
  mode: MollieMode,
  tenantId?: string,
): Promise<InvoiceDeliveryQueueSummary> {
  const resolvedTenantId = await resolveTenantId(tenantId);
  const result = await getDb().execute<{
    dueRetryFirstPaymentCount: number | string;
    dueRetryRecurringCount: number | string;
    permanentFailureFirstPaymentCount: number | string;
    permanentFailureRecurringCount: number | string;
  }>(sql`
    with payment_delivery as (
      select
        count(*) filter (
          where p.payment_type = 'first'
            and p.invoice_state = 'invoice_created'
            and p.invoice_sent_at is null
            and (
              case
                when lower(coalesce(p.metadata ->> 'invoiceDeliveryPermanentFailure', '')) in ('true', 'false')
                then (p.metadata ->> 'invoiceDeliveryPermanentFailure')::boolean
                else false
              end
            ) = true
        ) as permanent_first,
        count(*) filter (
          where p.payment_type = 'first'
            and p.invoice_state = 'invoice_created'
            and p.invoice_sent_at is null
            and (
              case
                when lower(coalesce(p.metadata ->> 'invoiceDeliveryPermanentFailure', '')) in ('true', 'false')
                then (p.metadata ->> 'invoiceDeliveryPermanentFailure')::boolean
                else false
              end
            ) = false
            and (
              case
                when coalesce(p.metadata ->> 'invoiceDeliveryAttemptCount', '') ~ '^[0-9]+$'
                then (p.metadata ->> 'invoiceDeliveryAttemptCount')::int
                else 0
              end
            ) < ${MAX_DELIVERY_ATTEMPTS}
            and (
              case
                when coalesce(p.metadata ->> 'invoiceDeliveryNextRetryAt', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
                then (p.metadata ->> 'invoiceDeliveryNextRetryAt')::timestamptz
                else to_timestamp(0)
              end
            ) <= now()
        ) as due_first
      from payments p
      where p.mode = ${mode}
        and p.tenant_id = ${resolvedTenantId}
    ),
    recurring_delivery as (
      select
        count(*) filter (
          where rbs.invoice_state = 'invoice_created'
            and rbs.invoice_sent_at is null
            and (
              case
                when lower(coalesce(rbs.metadata ->> 'invoiceDeliveryPermanentFailure', '')) in ('true', 'false')
                then (rbs.metadata ->> 'invoiceDeliveryPermanentFailure')::boolean
                else false
              end
            ) = true
        ) as permanent_recurring,
        count(*) filter (
          where rbs.invoice_state = 'invoice_created'
            and rbs.invoice_sent_at is null
            and (
              case
                when lower(coalesce(rbs.metadata ->> 'invoiceDeliveryPermanentFailure', '')) in ('true', 'false')
                then (rbs.metadata ->> 'invoiceDeliveryPermanentFailure')::boolean
                else false
              end
            ) = false
            and (
              case
                when coalesce(rbs.metadata ->> 'invoiceDeliveryAttemptCount', '') ~ '^[0-9]+$'
                then (rbs.metadata ->> 'invoiceDeliveryAttemptCount')::int
                else 0
              end
            ) < ${MAX_DELIVERY_ATTEMPTS}
            and (
              case
                when coalesce(rbs.metadata ->> 'invoiceDeliveryNextRetryAt', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
                then (rbs.metadata ->> 'invoiceDeliveryNextRetryAt')::timestamptz
                else to_timestamp(0)
              end
            ) <= now()
        ) as due_recurring
      from recurring_billing_schedules rbs
      where rbs.mode = ${mode}
        and rbs.tenant_id = ${resolvedTenantId}
    )
    select
      (select due_first from payment_delivery) as "dueRetryFirstPaymentCount",
      (select due_recurring from recurring_delivery) as "dueRetryRecurringCount",
      (select permanent_first from payment_delivery) as "permanentFailureFirstPaymentCount",
      (select permanent_recurring from recurring_delivery) as "permanentFailureRecurringCount"
  `);
  const row = result.rows[0];

  return {
    dueRetryFirstPaymentCount: Number(row?.dueRetryFirstPaymentCount ?? 0),
    dueRetryRecurringCount: Number(row?.dueRetryRecurringCount ?? 0),
    permanentFailureFirstPaymentCount: Number(
      row?.permanentFailureFirstPaymentCount ?? 0,
    ),
    permanentFailureRecurringCount: Number(
      row?.permanentFailureRecurringCount ?? 0,
    ),
  };
}
