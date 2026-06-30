import "server-only";

import type { Payment } from "@mollie/api-client";

import {
  deliverAlertEmail,
  openAlert,
  resolveAlertsForEntity,
} from "@/lib/reliability/alerts";
import {
  derivePaymentRecurringCollectionState,
  hasPaymentChargeback,
  resolvePaymentSyncType,
  serializePaymentStatusReason,
} from "@/lib/reliability/payment-sync-record";

export async function handlePaymentAlerts(input: {
  customerId: string | null;
  localPaymentId: string;
  payment: Payment;
  subscriptionId: string | null;
  tenantId: string;
}) {
  const paymentType = resolvePaymentSyncType(input.payment);
  const recurringCollectionState = derivePaymentRecurringCollectionState(input.payment);

  if (paymentType === "recurring") {
    if (recurringCollectionState === "pending_return_window") {
      return;
    }

    if (recurringCollectionState === "reversal_critical_review") {
      const alert = await openAlert({
        customerId: input.customerId,
        message:
          "A recurring SEPA direct debit was reversed or disputed. The invoice obligation may still be open; review Mollie and e-Boekhouden before changing service or billing state.",
        paymentId: input.localPaymentId,
        payload: {
          policy: "recurring_billing_policy",
          recurringCollectionState,
        },
        severity: "critical",
        subscriptionId: input.subscriptionId,
        tenantId: input.tenantId,
        title: "Recurring collection reversed",
      });

      if (alert.isNew) {
        await deliverAlertEmail({
          alertId: alert.id,
          message:
            "A recurring SEPA direct debit was reversed or disputed. Review Mollie, the invoice, and the subscription before taking action.",
          tenantId: input.tenantId,
          title: "Recurring collection reversed",
        });
      }

      return;
    }

    if (recurringCollectionState === "mandate_problem_review") {
      const alert = await openAlert({
        customerId: input.customerId,
        message:
          "A recurring collection failed with a possible mandate or bank-account problem. Do not rely on future automatic collection until the mandate or payment path is reviewed.",
        paymentId: input.localPaymentId,
        payload: {
          policy: "recurring_billing_policy",
          recurringCollectionState,
          statusReason: serializePaymentStatusReason(input.payment.statusReason),
        },
        severity: "critical",
        subscriptionId: input.subscriptionId,
        tenantId: input.tenantId,
        title: "Recurring mandate problem",
      });

      if (alert.isNew) {
        await deliverAlertEmail({
          alertId: alert.id,
          message:
            "A recurring collection failed with a possible mandate problem. Review the customer before retrying automatic collection.",
          tenantId: input.tenantId,
          title: "Recurring mandate problem",
        });
      }

      return;
    }

    if (recurringCollectionState === "failed_needs_review") {
      const alert = await openAlert({
        customerId: input.customerId,
        message:
          "A recurring collection failed. Keep the existing invoice open, do not create a duplicate invoice, and review the customer manually before retrying or changing service state.",
        paymentId: input.localPaymentId,
        payload: {
          invoiceStatePolicy: "keep_existing_invoice_open",
          noAutomaticCancellation: true,
          noAutomaticFees: true,
          policy: "recurring_billing_policy",
          recurringCollectionState,
        },
        severity: "warning",
        subscriptionId: input.subscriptionId,
        tenantId: input.tenantId,
        title: "Recurring collection failed",
      });

      if (alert.isNew) {
        await deliverAlertEmail({
          alertId: alert.id,
          message:
            "A recurring collection failed. Keep the existing invoice open and review manually; do not create a duplicate invoice or auto-cancel.",
          tenantId: input.tenantId,
          title: "Recurring collection failed",
        });
      }

      return;
    }

    if (recurringCollectionState === "settled") {
      await resolveAlertsForEntity({
        paymentId: input.localPaymentId,
        tenantId: input.tenantId,
      });
      return;
    }
  }

  if (hasPaymentChargeback(input.payment)) {
    const alert = await openAlert({
      customerId: input.customerId,
      message:
        "A payment appears to have been charged back or disputed. Review the payment in Mollie and decide how the subscription should proceed.",
      paymentId: input.localPaymentId,
      severity: "critical",
      subscriptionId: input.subscriptionId,
      tenantId: input.tenantId,
      title: "Disputed payment",
    });

    if (alert.isNew) {
      await deliverAlertEmail({
        alertId: alert.id,
        message:
          "A payment was marked as charged back or disputed during synchronization. Open Mollie Manager and review the payment immediately.",
        tenantId: input.tenantId,
        title: "Disputed payment",
      });
    }

    return;
  }

  if (input.payment.status === "failed" || input.payment.status === "expired") {
    const alertTitle =
      input.payment.status === "failed" ? "Failed payment" : "Expired payment";
    const alert = await openAlert({
      customerId: input.customerId,
      message:
        input.payment.status === "failed"
          ? "A payment failed and needs review before service continues."
          : "A checkout expired before the payment completed.",
      paymentId: input.localPaymentId,
      severity: "warning",
      subscriptionId: input.subscriptionId,
      tenantId: input.tenantId,
      title: alertTitle,
    });

    if (alert.isNew) {
      await deliverAlertEmail({
        alertId: alert.id,
        message:
          input.payment.status === "failed"
            ? "A payment failed during synchronization. Open Mollie Manager to review the payment and the affected customer."
            : "A Mollie checkout expired before completion. Open Mollie Manager to decide whether to issue a new payment.",
        tenantId: input.tenantId,
        title: alertTitle,
      });
    }

    return;
  }

  await resolveAlertsForEntity({
    paymentId: input.localPaymentId,
    tenantId: input.tenantId,
  });
}

export async function handleSubscriptionAlerts(input: {
  customerId: string;
  localSubscriptionId: string;
  localStatus: string;
  tenantId: string;
}) {
  if (input.localStatus === "payment_action_required") {
    const alert = await openAlert({
      customerId: input.customerId,
      message:
        "The subscription is suspended or waiting for a payment-related intervention in Mollie.",
      severity: "warning",
      subscriptionId: input.localSubscriptionId,
      tenantId: input.tenantId,
      title: "Subscription needs payment action",
    });

    if (alert.isNew) {
      await deliverAlertEmail({
        alertId: alert.id,
        message:
          "A subscription entered a payment-action-required state. Open Mollie Manager to inspect the latest payment and subscription details.",
        tenantId: input.tenantId,
        title: "Subscription needs payment action",
      });
    }

    return;
  }

  if (input.localStatus === "out_of_sync") {
    const alert = await openAlert({
      customerId: input.customerId,
      message:
        "The local subscription state no longer matches the latest Mollie state.",
      severity: "critical",
      subscriptionId: input.localSubscriptionId,
      tenantId: input.tenantId,
      title: "Subscription out of sync",
    });

    if (alert.isNew) {
      await deliverAlertEmail({
        alertId: alert.id,
        message:
          "A subscription appears out of sync with Mollie. Open Mollie Manager and run a sync or reconciliation pass.",
        tenantId: input.tenantId,
        title: "Subscription out of sync",
      });
    }

    return;
  }

  await resolveAlertsForEntity({
    subscriptionId: input.localSubscriptionId,
    tenantId: input.tenantId,
  });
}
