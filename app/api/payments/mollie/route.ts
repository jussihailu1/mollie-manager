import { sql } from "drizzle-orm";
import { type NextRequest } from "next/server";
import type Payment from "@mollie/api-client/dist/types/data/payments/Payment";

import { requireViewerSession } from "@/lib/auth/session";
import { getSelectedMollieMode } from "@/lib/dashboard-mode";
import { getDb } from "@/lib/db";
import { getEboekhoudenInvoice } from "@/lib/eboekhouden/client";
import type { PaymentDrawerData } from "@/lib/payment-details";
import { getMollieClient } from "@/lib/mollie/client";

type LocalPaymentLookup = {
  customerId: string | null;
  customerName: string | null;
  eboekhoudenInvoiceId: string | null;
  eboekhoudenInvoiceNumber: string | null;
  id: string;
  invoiceState: PaymentDrawerData["invoiceState"];
  molliePaymentId: string | null;
  metadata: Record<string, unknown>;
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
    return invoiceDocumentUrl;
  }

  const eboekhoudenInvoice = metadata.eboekhoudenInvoice;
  if (
    eboekhoudenInvoice &&
    typeof eboekhoudenInvoice === "object" &&
    !Array.isArray(eboekhoudenInvoice)
  ) {
    const nestedUrl = (eboekhoudenInvoice as Record<string, unknown>).urlPdfFile;
    if (typeof nestedUrl === "string" && nestedUrl.trim()) {
      return nestedUrl;
    }
  }

  return null;
}

async function resolveInvoicePdfUrl(localPayment: LocalPaymentLookup) {
  const metadataUrl = extractInvoicePdfUrl(localPayment.metadata);
  if (metadataUrl) {
    return metadataUrl;
  }

  if (!localPayment.eboekhoudenInvoiceId) {
    return null;
  }

  const invoiceId = Number(localPayment.eboekhoudenInvoiceId);
  if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
    return null;
  }

  try {
    const invoice = await getEboekhoudenInvoice(invoiceId);
    return invoice.urlPdfFile ?? null;
  } catch {
    return null;
  }
}

async function toPaymentDrawerData(
  localPayment: LocalPaymentLookup,
  payment: Payment,
): Promise<PaymentDrawerData> {
  const invoicePdfUrl = await resolveInvoicePdfUrl(localPayment);

  return {
    customerId: localPayment.customerId,
    customerName: localPayment.customerName,
    eboekhoudenInvoiceId: localPayment.eboekhoudenInvoiceId,
    eboekhoudenInvoiceNumber: localPayment.eboekhoudenInvoiceNumber,
    invoicePdfUrl,
    invoiceState: localPayment.invoiceState,
    localPaymentId: localPayment.id,
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
      webhookUrl: payment.webhookUrl ?? null,
    },
  };
}

export async function GET(request: NextRequest) {
  await requireViewerSession();

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
  const result = await getDb().execute<LocalPaymentLookup>(sql`
      select
        p.id,
        p.invoice_state as "invoiceState",
        p.eboekhouden_invoice_id as "eboekhoudenInvoiceId",
        p.eboekhouden_invoice_number as "eboekhoudenInvoiceNumber",
        p.metadata as "metadata",
        p.mollie_payment_id as "molliePaymentId",
        c.id as "customerId",
        coalesce(nullif(c.metadata ->> 'businessName', ''), c.full_name, c.email) as "customerName"
      from payments p
      left join customers c on c.id = p.customer_id and c.mode = p.mode
      where p.mode = ${selectedMode}
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
    const payment = await getMollieClient(selectedMode).payments.get(
      localPayment.molliePaymentId,
    );

    return Response.json(await toPaymentDrawerData(localPayment, payment));
  } catch {
    return Response.json(
      {
        error: "Failed to fetch the live payment from Mollie.",
      },
      { status: 502 },
    );
  }
}
