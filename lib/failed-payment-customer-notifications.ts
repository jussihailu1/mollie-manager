import "server-only";

import type { Payment } from "@mollie/api-client";
import { sql } from "drizzle-orm";

import { writeAuditLog } from "@/lib/audit";
import { getDb, type DbClient } from "@/lib/db";
import { env } from "@/lib/env";
import {
  buildFailedPaymentCustomerEmail,
} from "@/lib/failed-payment-customer-email";
import {
  runFailedPaymentNotificationFlow,
  type FailedPaymentNotificationClaim,
  type FailedPaymentNotificationContext,
} from "@/lib/failed-payment-notification-flow";
import { classifyPaymentOutcome } from "@/lib/payment-outcome-classification";
import { sendEmailTo, notificationsAreConfigured } from "@/lib/notifications/email";
import { openAlert } from "@/lib/reliability/alerts";
import {
  hasPaymentChargeback,
  hasPaymentRefundOrReversal,
  resolvePaymentSyncType,
  serializePaymentStatusReason,
} from "@/lib/reliability/payment-sync-record";
import type { RecurringCollectionState } from "@/lib/recurring-billing-policy";

type PaymentNotificationContextRow = {
  amountCurrency: string | null;
  amountValue: string | null;
  customerEmail: string | null;
  customerId: string | null;
  customerName: string | null;
  firstPaymentMode: "mandate_only" | "real_installment" | null;
  invoiceNumber: string | null;
  plannedCollectionDate: string | null;
  subscriptionId: string | null;
};

type ExistingNotificationRow = {
  id: string;
};

function resolveFlowKind(input: {
  firstPaymentMode: "mandate_only" | "real_installment" | null;
  paymentType: "first" | "manual" | "recurring";
}) {
  if (input.paymentType === "recurring") {
    return "recurring";
  }

  if (input.paymentType === "first") {
    return input.firstPaymentMode === "mandate_only"
      ? "mandate_only"
      : "first_payment";
  }

  return "manual";
}

async function loadPaymentNotificationContext(
  localPaymentId: string,
  client?: DbClient,
) {
  const db = client ?? getDb();
  const result = await db.execute<PaymentNotificationContextRow>(sql`
      select
        p.customer_id as "customerId",
        p.subscription_id as "subscriptionId",
        p.amount_value::text as "amountValue",
        p.amount_currency as "amountCurrency",
        p.eboekhouden_invoice_number as "invoiceNumber",
        p.metadata ->> 'firstPaymentMode' as "firstPaymentMode",
        coalesce(nullif(c.metadata ->> 'businessName', ''), c.full_name) as "customerName",
        c.email as "customerEmail",
        rbs.planned_collection_date::text as "plannedCollectionDate"
      from payments p
      left join customers c on c.id = p.customer_id
      left join recurring_billing_schedules rbs on rbs.payment_id = p.id
      where p.id = ${localPaymentId}
      limit 1
    `);

  return result.rows[0] ?? null;
}

async function claimCustomerNotification(
  context: FailedPaymentNotificationContext,
  client?: DbClient,
): Promise<FailedPaymentNotificationClaim> {
  const db = client ?? getDb();
  const email = buildFailedPaymentCustomerEmail(context);
  const notificationId = crypto.randomUUID();
  const result = await db.execute<ExistingNotificationRow>(sql`
      insert into customer_payment_notifications (
        id,
        mode,
        notification_type,
        status,
        customer_id,
        payment_id,
        subscription_id,
        recipient_email,
        subject,
        outcome_state,
        outcome_reason,
        template_version
      ) values (
        ${notificationId},
        ${context.mode},
        'failed_payment',
        'claimed',
        ${context.customerId},
        ${context.localPaymentId},
        ${context.subscriptionId},
        ${context.customerEmail},
        ${email.shouldSend ? email.subject : null},
        ${context.outcome.state},
        ${context.outcome.reason},
        1
      )
      on conflict (mode, payment_id, notification_type) do nothing
      returning id
    `);

  return {
    id: result.rows[0]?.id ?? null,
    isClaimed: Boolean(result.rows[0]?.id),
  };
}

async function markCustomerNotificationSent(claim: FailedPaymentNotificationClaim) {
  if (!claim.id) {
    return;
  }

  await getDb().execute(sql`
      update customer_payment_notifications
      set
        status = 'sent',
        sent_at = now(),
        attempt_count = attempt_count + 1,
        updated_at = now()
      where id = ${claim.id}
    `);
}

async function markCustomerNotificationFailed(
  claim: FailedPaymentNotificationClaim,
  errorMessage: string,
) {
  if (!claim.id) {
    return;
  }

  await getDb().execute(sql`
      update customer_payment_notifications
      set
        status = 'failed',
        failed_at = now(),
        attempt_count = attempt_count + 1,
        last_error_message = ${errorMessage.slice(0, 180)},
        updated_at = now()
      where id = ${claim.id}
    `);
}

function buildOperatorAlertPayload(context: FailedPaymentNotificationContext) {
  return {
    notificationPolicy: "failed_payment_customer_notification",
    outcomeReason: context.outcome.reason,
    outcomeState: context.outcome.state,
    policy: "recurring_billing_policy",
  };
}

export async function runFailedPaymentCustomerNotificationForSyncedPayment(input: {
  localPaymentId: string;
  mode: "live" | "test";
  payment: Payment;
  recurringCollectionState: RecurringCollectionState;
}) {
  const row = await loadPaymentNotificationContext(input.localPaymentId);

  if (!row) {
    return {
      customerEmailSent: false,
      customerNotificationClaimed: false,
      operatorTaskId: null,
    };
  }

  const paymentType = resolvePaymentSyncType(input.payment);
  const outcome = classifyPaymentOutcome({
    createdAt: input.payment.createdAt,
    flowKind: resolveFlowKind({
      firstPaymentMode: row.firstPaymentMode,
      paymentType,
    }),
    hasChargeback: hasPaymentChargeback(input.payment),
    hasRefundOrReversal: hasPaymentRefundOrReversal(input.payment),
    now: new Date(),
    status: input.payment.status,
    statusReason: serializePaymentStatusReason(input.payment.statusReason),
  });
  const context: FailedPaymentNotificationContext = {
    amountCurrency: row.amountCurrency,
    amountValue: row.amountValue,
    contactEmail: env.SUBSCRIPTION_CANCELLATION_EMAIL ?? env.ALERT_EMAIL_TO ?? null,
    customerEmail: row.customerEmail,
    customerId: row.customerId,
    customerName: row.customerName,
    invoiceNumber: row.invoiceNumber,
    localPaymentId: input.localPaymentId,
    mode: input.mode,
    molliePaymentId: input.payment.id,
    outcome,
    plannedCollectionDate: row.plannedCollectionDate,
    subscriptionId: row.subscriptionId,
  };

  return runFailedPaymentNotificationFlow(context, {
    claimCustomerNotification,
    markCustomerNotificationFailed,
    markCustomerNotificationSent,
    notificationsAreConfigured,
    openOperatorTask: async (taskContext) => {
      return openAlert({
        customerId: taskContext.customerId,
        message:
          "A failed or reversed payment needs manual review. Keep any existing invoice open and do not automatically pause, cancel, add fees, dun, or escalate.",
        paymentId: taskContext.localPaymentId,
        payload: buildOperatorAlertPayload(taskContext),
        severity:
          taskContext.outcome.state === "charged_back" ||
          taskContext.outcome.state === "reversed" ||
          taskContext.outcome.state === "mandate_problem"
            ? "critical"
            : "warning",
        subscriptionId: taskContext.subscriptionId,
        title: "Failed payment customer follow-up",
      });
    },
    sendCustomerEmail: sendEmailTo,
    writeAudit: async (audit) => {
      await writeAuditLog({
        action: audit.action,
        details: {
          localPaymentId: context.localPaymentId,
          molliePaymentId: context.molliePaymentId,
          outcomeReason: context.outcome.reason,
          outcomeState: context.outcome.state,
        },
        entityId: audit.entityId,
        entityType: "payment",
        mode: context.mode,
        outcome: audit.outcome,
        summary: audit.summary,
      });
    },
  });
}
