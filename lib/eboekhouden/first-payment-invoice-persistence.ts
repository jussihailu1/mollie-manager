import { sql } from "drizzle-orm";

import { writeAuditLog } from "@/lib/audit";
import { getDb, transaction } from "@/lib/db";
import type { MollieMode } from "@/lib/env";
import { openAlert } from "@/lib/reliability/alerts";
import {
  buildInvoiceCreationClaimMetadata,
  buildInvoiceCreationFailureMetadata,
  buildInvoiceCreationSuccessMetadata,
} from "@/lib/eboekhouden/invoice-creation-metadata";
import { serializeInvoiceErrorMessage } from "@/lib/eboekhouden/invoice-flow-helpers";
import type { EboekhoudenInvoice } from "@/lib/eboekhouden/client";

export type FirstPaymentInvoiceActor = {
  email?: string | null;
  kind: "system" | "user";
};

export type FirstPaymentInvoicePersistenceCandidate = {
  consentId: string;
  customerId: string | null;
  mode: MollieMode;
  molliePaymentId: string | null;
  paymentId: string;
  paymentLinkId: string;
  subscriptionId: string | null;
  tenantId: string;
};

type AlertResult = {
  id: string;
  isNew: boolean;
};

function serializeFirstPaymentInvoiceError(error: unknown) {
  return serializeInvoiceErrorMessage(
    error,
    "First-payment invoice creation failed.",
  );
}

export async function claimFirstPaymentInvoiceForCreation(input: {
  actor: FirstPaymentInvoiceActor;
  mode: MollieMode;
  paymentId: string;
  tenantId: string;
}) {
  const result = await getDb().execute<{ id: string }>(sql`
    update payments
    set
      invoice_state = 'invoice_creating',
      invoice_failed_at = null,
      updated_at = now(),
      metadata = coalesce(metadata, '{}'::jsonb) || ${JSON.stringify(
        buildInvoiceCreationClaimMetadata({
          actorEmail: input.actor.email,
        }),
      )}::jsonb
    where id = ${input.paymentId}
      and tenant_id = ${input.tenantId}
      and mode = ${input.mode}
      and payment_type = 'first'
      and mollie_status = 'paid'
      and invoice_state = 'pending_invoice'
      and eboekhouden_invoice_id is null
      and eboekhouden_invoice_number is null
    returning id
  `);

  return result.rows[0]?.id ?? null;
}

export async function storeFirstPaymentInvoiceCreationSuccess(input: {
  actor: FirstPaymentInvoiceActor;
  candidate: FirstPaymentInvoicePersistenceCandidate;
  invoice: EboekhoudenInvoice;
  source?: "created" | "reconciled_existing";
}) {
  const invoiceId = input.invoice.id ? String(input.invoice.id) : null;
  const invoiceNumber = input.invoice.invoiceNumber ?? input.invoice.number ?? null;
  const source = input.source ?? "created";
  const alertResult = await transaction<AlertResult>(async (tx) => {
    await tx.execute(sql`
      update payments
      set
        invoice_state = 'invoice_created',
        eboekhouden_invoice_id = ${invoiceId},
        eboekhouden_invoice_number = ${invoiceNumber},
        invoice_created_at = now(),
        invoice_failed_at = null,
        metadata = coalesce(metadata, '{}'::jsonb) || ${JSON.stringify(
          buildInvoiceCreationSuccessMetadata({ invoice: input.invoice }),
        )}::jsonb,
        updated_at = now()
      where id = ${input.candidate.paymentId}
        and tenant_id = ${input.candidate.tenantId}
        and invoice_state = 'invoice_creating'
    `);

    await writeAuditLog(
      {
        action: "first_payment_invoice.create",
        details: {
          consentId: input.candidate.consentId,
          eboekhoudenInvoiceId: invoiceId,
          eboekhoudenInvoiceNumber: invoiceNumber,
          source,
          molliePaymentId: input.candidate.molliePaymentId,
          paymentId: input.candidate.paymentId,
          paymentLinkId: input.candidate.paymentLinkId,
        },
        entityId: input.candidate.paymentId,
        entityType: "payment",
        mode: input.candidate.mode,
        outcome: "success",
        summary:
          source === "created"
            ? "Created an e-Boekhouden invoice for a paid first payment."
            : "Recovered an existing e-Boekhouden invoice for a paid first payment.",
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
        and payment_id = ${input.candidate.paymentId}
        and payload ->> 'kind' = 'first_payment_invoice_creation_failed'
        and payload ->> 'tenantId' = ${input.candidate.tenantId}
    `);

    return openAlert(
      {
        customerId: input.candidate.customerId,
        message:
          source === "created"
            ? `Created e-Boekhouden invoice ${invoiceNumber ?? invoiceId ?? "without returned number"} for the paid first payment ${input.candidate.paymentId}.`
            : `Recovered existing e-Boekhouden invoice ${invoiceNumber ?? invoiceId ?? "without returned number"} for the paid first payment ${input.candidate.paymentId}.`,
        paymentId: input.candidate.paymentId,
        payload: {
          consentId: input.candidate.consentId,
          eboekhoudenInvoiceId: invoiceId,
          eboekhoudenInvoiceNumber: invoiceNumber,
          kind: "first_payment_invoice_created",
          mode: input.candidate.mode,
          paymentId: input.candidate.paymentId,
          source,
        },
        severity: "info",
        subscriptionId: input.candidate.subscriptionId,
        tenantId: input.candidate.tenantId,
        title:
          source === "created"
            ? "First-payment invoice created"
            : "First-payment invoice recovered",
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

export async function storeFirstPaymentInvoiceCreationFailure(input: {
  actor: FirstPaymentInvoiceActor;
  candidate: FirstPaymentInvoicePersistenceCandidate;
  error: unknown;
}) {
  const errorMessage = serializeFirstPaymentInvoiceError(input.error);
  const alertResult = await transaction<AlertResult>(async (tx) => {
    await tx.execute(sql`
      update payments
      set
        invoice_state = 'invoice_failed',
        invoice_failed_at = now(),
        metadata = coalesce(metadata, '{}'::jsonb) || ${JSON.stringify(
          buildInvoiceCreationFailureMetadata({ errorMessage }),
        )}::jsonb,
        updated_at = now()
      where id = ${input.candidate.paymentId}
        and tenant_id = ${input.candidate.tenantId}
        and invoice_state = 'invoice_creating'
    `);

    await writeAuditLog(
      {
        action: "first_payment_invoice.create",
        details: {
          consentId: input.candidate.consentId,
          error: errorMessage,
          molliePaymentId: input.candidate.molliePaymentId,
          paymentId: input.candidate.paymentId,
          paymentLinkId: input.candidate.paymentLinkId,
        },
        entityId: input.candidate.paymentId,
        entityType: "payment",
        mode: input.candidate.mode,
        outcome: "failure",
        summary: "First-payment invoice creation failed for a paid first payment.",
      },
      tx,
      input.actor,
    );

    return openAlert(
      {
        customerId: input.candidate.customerId,
        message:
          "Could not create the first-payment e-Boekhouden invoice. Review the payment before retrying so a duplicate invoice is not created upstream.",
        paymentId: input.candidate.paymentId,
        payload: {
          consentId: input.candidate.consentId,
          error: errorMessage,
          kind: "first_payment_invoice_creation_failed",
          mode: input.candidate.mode,
          paymentId: input.candidate.paymentId,
        },
        severity: "warning",
        subscriptionId: input.candidate.subscriptionId,
        tenantId: input.candidate.tenantId,
        title: "First-payment invoice creation failed",
      },
      tx,
    );
  });

  return {
    alert: alertResult,
    errorMessage,
  };
}
