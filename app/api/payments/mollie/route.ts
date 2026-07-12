import { sql } from "drizzle-orm";
import { type NextRequest } from "next/server";
import type Payment from "@mollie/api-client/dist/types/data/payments/Payment";

import { getSelectedMollieMode } from "@/lib/dashboard-mode";
import { getDb } from "@/lib/db";
import { normalizeTrustedInvoicePdfUrl } from "@/lib/invoice-pdf";
import { getStoredInvoiceByOwner } from "@/lib/invoices";
import { getInvoiceProviderAdapterById } from "@/lib/invoicing/provider-resolver";
import { getTenantMollieClient } from "@/lib/mollie/client";
import type { PaymentDrawerData } from "@/lib/payment-details";
import { getCurrentTenantSelectionForViewer } from "@/lib/tenant-context";

type LocalPaymentLookup = {
  customerId: string | null;
  customerName: string | null;
  eboekhoudenInvoiceId: string | null;
  eboekhoudenInvoiceNumber: string | null;
  id: string;
  invoiceDocumentUrl: string | null;
  invoiceState: PaymentDrawerData["invoiceState"];
  invoiceCreatedAt: string | null;
  invoiceDeliveryIntendedRecipient: string | null;
  invoiceDeliveryRecipient: string | null;
  invoiceProvider: "eboekhouden" | "mollie" | null;
  invoiceRecipientOverridden: boolean;
  invoiceSentAt: string | null;
  invoiceSource: string | null;
  invoiceTriggerAction: string | null;
  invoiceTriggerActorEmail: string | null;
  invoiceTriggerActorKind: "system" | "user" | null;
  invoiceTriggerSource: string | null;
  invoiceOwnerId: string | null;
  invoiceOwnerType: PaymentDrawerData["invoice"]["ownerType"];
  lastSyncedAt: string | null;
  molliePaymentId: string | null;
  invoiceMetadata: Record<string, unknown>;
};

function toLinkMap(links: Payment["_links"] | undefined) {
  if (!links || typeof links !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(links).flatMap(([key, value]) => {
      if (
        value &&
        typeof value === "object" &&
        "href" in value &&
        typeof value.href === "string"
      ) {
        return [[key, value.href]];
      }

      return [];
    }),
  );
}

function toAmountSnapshot(
  amount: Payment["amount"] | Payment["amountRefunded"] | Payment["amountRemaining"] | Payment["amountCaptured"] | Payment["amountChargedBack"] | Payment["settlementAmount"] | undefined,
) {
  if (!amount) {
    return null;
  }

  return {
    currency: amount.currency,
    value: amount.value,
  };
}

function extractInvoicePdfUrl(metadata: Record<string, unknown>) {
  const invoiceDocumentUrl = metadata.invoiceDocumentUrl;
  if (typeof invoiceDocumentUrl === "string" && invoiceDocumentUrl.trim()) {
    const trustedUrl = normalizeTrustedInvoicePdfUrl(invoiceDocumentUrl);
    if (trustedUrl) {
      return trustedUrl;
    }
  }

  const eboekhoudenInvoice = metadata.eboekhoudenInvoice;
  if (
    eboekhoudenInvoice &&
    typeof eboekhoudenInvoice === "object" &&
    !Array.isArray(eboekhoudenInvoice)
  ) {
    const nestedUrl = (eboekhoudenInvoice as Record<string, unknown>).urlPdfFile;
    if (typeof nestedUrl === "string" && nestedUrl.trim()) {
      const trustedUrl = normalizeTrustedInvoicePdfUrl(nestedUrl);
      if (trustedUrl) {
        return trustedUrl;
      }
    }
  }

  return null;
}

function extractInvoiceAttachmentStatus(
  metadata: Record<string, unknown>,
): PaymentDrawerData["invoice"]["documentAttachmentStatus"] {
  const status = metadata.invoiceDocumentAttachmentStatus;

  switch (status) {
    case "attached":
    case "download_failed":
    case "invalid_content_type":
    case "invalid_pdf":
    case "missing_url":
    case "timeout":
    case "too_large":
    case "untrusted_url":
      return status;
    default:
      return null;
  }
}

async function resolveInvoicePdfUrl(
  localPayment: LocalPaymentLookup,
  tenantId: string,
) {
  const metadataUrl =
    normalizeTrustedInvoicePdfUrl(localPayment.invoiceDocumentUrl) ??
    extractInvoicePdfUrl(localPayment.invoiceMetadata);
  if (metadataUrl) {
    return metadataUrl;
  }

  if (!localPayment.invoiceOwnerId || !localPayment.invoiceOwnerType) {
    return null;
  }

  const storedInvoice = await getStoredInvoiceByOwner({
    ownerId: localPayment.invoiceOwnerId,
    ownerType: localPayment.invoiceOwnerType,
    tenantId,
  });

  if (!storedInvoice) {
    return null;
  }

  try {
    const provider = getInvoiceProviderAdapterById(storedInvoice.provider);
    const invoiceDocumentUrl = await provider.getInvoiceDocument({
      invoice: storedInvoice,
      tenantId,
    });
    return normalizeTrustedInvoicePdfUrl(invoiceDocumentUrl);
  } catch {
    return null;
  }
}

async function toPaymentDrawerData(
  localPayment: LocalPaymentLookup,
  payment: Payment,
  tenantId: string,
): Promise<PaymentDrawerData> {
  const invoicePdfUrl = await resolveInvoicePdfUrl(localPayment, tenantId);
  const documentAttachmentStatus = extractInvoiceAttachmentStatus(
    localPayment.invoiceMetadata,
  );
  const triggerKind: PaymentDrawerData["invoice"]["triggerKind"] =
    localPayment.invoiceTriggerSource === "reconciled_existing"
      ? "recovered_existing"
      : localPayment.invoiceTriggerActorKind === "user"
        ? "manual"
        : localPayment.invoiceTriggerActorKind === "system"
          ? "automation"
          : "unknown";

  return {
    customerId: localPayment.customerId,
    customerName: localPayment.customerName,
    eboekhoudenInvoiceId: localPayment.eboekhoudenInvoiceId,
    eboekhoudenInvoiceNumber: localPayment.eboekhoudenInvoiceNumber,
    invoice: {
      createdAt: localPayment.invoiceCreatedAt,
      createdByAction: localPayment.invoiceTriggerAction,
      createdByActorEmail: localPayment.invoiceTriggerActorEmail,
      createdByActorKind: localPayment.invoiceTriggerActorKind,
      deliveryRecipient: localPayment.invoiceDeliveryRecipient,
      documentAttachmentStatus,
      eboekhoudenInvoiceId: localPayment.eboekhoudenInvoiceId,
      eboekhoudenInvoiceNumber: localPayment.eboekhoudenInvoiceNumber,
      intendedRecipient: localPayment.invoiceDeliveryIntendedRecipient,
      invoicePdfUrl,
      ownerId: localPayment.invoiceOwnerId,
      ownerType: localPayment.invoiceOwnerType,
      recipientOverridden: localPayment.invoiceRecipientOverridden,
      sentAt: localPayment.invoiceSentAt,
      source: localPayment.invoiceSource,
      state: localPayment.invoiceState,
      triggerKind,
    },
    invoicePdfUrl,
    invoiceState: localPayment.invoiceState,
    localPaymentId: localPayment.id,
    lastSyncedAt: localPayment.lastSyncedAt,
    molliePaymentId: payment.id,
    payment: {
      amount: {
        currency: payment.amount.currency,
        value: payment.amount.value,
      },
      amountCaptured: toAmountSnapshot(payment.amountCaptured),
      amountChargedBack: toAmountSnapshot(payment.amountChargedBack),
      amountRefunded: toAmountSnapshot(payment.amountRefunded),
      amountRemaining: toAmountSnapshot(payment.amountRemaining),
      applicationFee: payment.applicationFee ?? null,
      authorizedAt: payment.authorizedAt ?? null,
      billingAddress: payment.billingAddress ?? null,
      cancelUrl: payment.cancelUrl ?? null,
      canceledAt: payment.canceledAt ?? null,
      captureBefore: payment.captureBefore ?? null,
      captureDelay: payment.captureDelay ?? null,
      captureMode: payment.captureMode ?? null,
      countryCode: payment.countryCode ?? null,
      createdAt: payment.createdAt,
      customerId: payment.customerId ?? null,
      description: payment.description,
      details: payment.details ?? null,
      expiredAt: payment.expiredAt ?? null,
      expiresAt: payment.expiresAt ?? null,
      failedAt: payment.failedAt ?? null,
      isCancelable: typeof payment.isCancelable === "boolean" ? payment.isCancelable : null,
      issuer: payment.issuer ?? null,
      lines: payment.lines ?? null,
      links: toLinkMap(payment._links),
      locale: payment.locale ?? null,
      mandateId: payment.mandateId ?? null,
      metadata: payment.metadata ?? null,
      method: payment.method ?? null,
      mode: payment.mode,
      orderId: payment.orderId ?? null,
      paidAt: payment.paidAt ?? null,
      profileId: payment.profileId ?? null,
      redirectUrl: payment.redirectUrl ?? null,
      restrictPaymentMethodsToCountry:
        payment.restrictPaymentMethodsToCountry ?? null,
      routing: payment.routing ?? null,
      sequenceType: payment.sequenceType ?? null,
      settlementAmount: toAmountSnapshot(payment.settlementAmount),
      settlementId: payment.settlementId ?? null,
      shippingAddress: payment.shippingAddress ?? null,
      status: payment.status,
      statusReason: payment.statusReason ?? null,
      subscriptionId: payment.subscriptionId ?? null,
      webhookUrlStatus: payment.webhookUrl ? "hidden" : "missing",
    },
  };
}

export async function GET(request: NextRequest) {
  const { currentTenant } = await getCurrentTenantSelectionForViewer();

  const paymentId = request.nextUrl.searchParams.get("paymentId")?.trim() ?? "";
  const molliePaymentId =
    request.nextUrl.searchParams.get("molliePaymentId")?.trim() ?? "";

  if (!paymentId && !molliePaymentId) {
    return Response.json(
      {
        error: "Provide a payment id or Mollie payment id.",
      },
      { status: 400 },
    );
  }

  const selectedMode = await getSelectedMollieMode();
  const tenantId = currentTenant.id;
  const result = await getDb().execute<LocalPaymentLookup>(sql`
      with invoice_context as (
        select
          p.id as payment_id,
          case
            when p.payment_type = 'recurring' and rbs.id is not null
              then rbs.invoice_state::text
            else p.invoice_state::text
          end as invoice_state,
          case
            when p.payment_type = 'recurring' and rbs.id is not null
              then rbs.invoice_created_at
            else p.invoice_created_at
          end as invoice_created_at,
          case
            when p.payment_type = 'recurring' and rbs.id is not null
              then rbs.invoice_sent_at
            else p.invoice_sent_at
          end as invoice_sent_at,
          case
            when p.payment_type = 'recurring' and rbs.id is not null
              then rbs.metadata
            else p.metadata
          end as invoice_metadata,
          case
            when p.payment_type = 'recurring' and rbs.id is not null
              then rbs.id
            else p.id
          end as invoice_owner_id,
          case
            when p.payment_type = 'recurring' and rbs.id is not null
              then 'recurring_schedule'
            else 'payment'
          end as invoice_owner_type,
          i.provider as invoice_provider,
          i.provider_invoice_id as provider_invoice_id,
          i.provider_invoice_number as provider_invoice_number,
          i.provider_document_url as provider_document_url,
          case
            when p.payment_type = 'recurring' and rbs.id is not null
              then rbs.metadata ->> 'source'
            else null
          end as invoice_source,
          case
            when p.payment_type = 'recurring' and rbs.id is not null
              then nullif(rbs.metadata ->> 'invoiceDeliveryRecipient', '')
            else nullif(p.metadata ->> 'invoiceDeliveryRecipient', '')
          end as invoice_delivery_recipient,
          case
            when p.payment_type = 'recurring' and rbs.id is not null
              then nullif(rbs.metadata ->> 'invoiceIntendedRecipient', '')
            else nullif(p.metadata ->> 'invoiceIntendedRecipient', '')
          end as invoice_delivery_intended_recipient,
          case
            when p.payment_type = 'recurring' and rbs.id is not null
              then coalesce((rbs.metadata ->> 'invoiceRecipientOverridden')::boolean, false)
            else coalesce((p.metadata ->> 'invoiceRecipientOverridden')::boolean, false)
          end as invoice_recipient_overridden
        from payments p
        left join recurring_billing_schedules rbs
          on rbs.payment_id = p.id
          and rbs.tenant_id = p.tenant_id
        left join invoices i
          on i.tenant_id = p.tenant_id
          and i.mode = p.mode
          and (
            (p.payment_type = 'recurring' and rbs.id is not null and i.owner_type = 'recurring_schedule' and i.owner_id = rbs.id)
            or
            ((p.payment_type <> 'recurring' or rbs.id is null) and i.owner_type = 'payment' and i.owner_id = p.id)
          )
        where p.tenant_id = ${tenantId}
          and p.mode = ${selectedMode}
          and (
            (${paymentId || null}::text is not null and p.id = ${paymentId || null})
            or (${molliePaymentId || null}::text is not null and p.mollie_payment_id = ${molliePaymentId || null})
          )
        limit 1
      )
      select
        p.id,
        p.last_synced_at as "lastSyncedAt",
        p.mollie_payment_id as "molliePaymentId",
        c.id as "customerId",
        coalesce(nullif(c.metadata ->> 'businessName', ''), c.full_name, c.email) as "customerName",
        ic.invoice_state as "invoiceState",
        ic.invoice_created_at as "invoiceCreatedAt",
        ic.invoice_sent_at as "invoiceSentAt",
        ic.provider_invoice_id as "eboekhoudenInvoiceId",
        ic.provider_invoice_number as "eboekhoudenInvoiceNumber",
        ic.provider_document_url as "invoiceDocumentUrl",
        ic.invoice_metadata as "invoiceMetadata",
        ic.invoice_owner_id as "invoiceOwnerId",
        ic.invoice_owner_type as "invoiceOwnerType",
        ic.invoice_provider as "invoiceProvider",
        ic.invoice_source as "invoiceSource",
        ic.invoice_delivery_recipient as "invoiceDeliveryRecipient",
        ic.invoice_delivery_intended_recipient as "invoiceDeliveryIntendedRecipient",
        ic.invoice_recipient_overridden as "invoiceRecipientOverridden",
        creation_audit.action as "invoiceTriggerAction",
        creation_audit.actor_email as "invoiceTriggerActorEmail",
        creation_audit.actor_kind as "invoiceTriggerActorKind",
        coalesce(
          creation_audit.details ->> 'source',
          creation_audit.details ->> 'invoiceRecoverySource'
        ) as "invoiceTriggerSource"
      from payments p
      inner join invoice_context ic on ic.payment_id = p.id
      left join customers c
        on c.id = p.customer_id
        and c.tenant_id = p.tenant_id
        and c.mode = p.mode
      left join lateral (
        select
          al.action,
          al.actor_email,
          al.actor_kind,
          al.details
        from audit_logs al
        where
          al.entity_id = ic.invoice_owner_id
          and (
            (
              ic.invoice_owner_type = 'payment'
              and al.entity_type = 'payment'
              and exists (
                select 1
                from payments ap
                where ap.id = al.entity_id
                  and ap.tenant_id = ${tenantId}
              )
            )
            or (
              ic.invoice_owner_type = 'recurring_schedule'
              and al.entity_type = 'recurring_billing_schedule'
              and exists (
                select 1
                from recurring_billing_schedules arbs
                where arbs.id = al.entity_id
                  and arbs.tenant_id = ${tenantId}
              )
            )
          )
          and al.action in ('first_payment_invoice.create', 'recurring_invoice.create')
        order by al.created_at desc
        limit 1
      ) creation_audit on true
      where p.tenant_id = ${tenantId}
        and p.mode = ${selectedMode}
        and (
          (${paymentId || null}::text is not null and p.id = ${paymentId || null})
          or (${molliePaymentId || null}::text is not null and p.mollie_payment_id = ${molliePaymentId || null})
        )
      limit 1
    `);
  const localPayment = result.rows[0];

  if (!localPayment) {
    return Response.json(
      {
        error: "Payment not found for the selected Mollie mode.",
      },
      { status: 404 },
    );
  }

  if (!localPayment.molliePaymentId) {
    return Response.json(
      {
        error: "This payment does not have a Mollie payment id.",
      },
      { status: 404 },
    );
  }

  try {
    const mollie = await getTenantMollieClient(tenantId, selectedMode);
    const payment = await mollie.payments.get(
      localPayment.molliePaymentId,
    );

    return Response.json(
      await toPaymentDrawerData(localPayment, payment, tenantId),
    );
  } catch {
    return Response.json(
      {
        error: "Failed to fetch the live payment from Mollie.",
      },
      { status: 502 },
    );
  }
}
