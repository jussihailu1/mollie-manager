import {
  buildFailedPaymentCustomerEmail,
  type FailedPaymentCustomerEmailInput,
} from "@/lib/failed-payment-customer-email";
import type { PaymentOutcomeClassification } from "@/lib/payment-outcome-classification";

export type FailedPaymentNotificationContext = Omit<
  FailedPaymentCustomerEmailInput,
  "outcome"
> & {
  customerId: string | null;
  customerEmail: string | null;
  localPaymentId: string;
  mode: "live" | "test";
  molliePaymentId: string | null;
  outcome: PaymentOutcomeClassification;
  subscriptionId: string | null;
};

export type FailedPaymentNotificationClaim = {
  id: string | null;
  isClaimed: boolean;
};

export type FailedPaymentNotificationDependencies = {
  claimCustomerNotification: (
    context: FailedPaymentNotificationContext,
  ) => Promise<FailedPaymentNotificationClaim>;
  markCustomerNotificationFailed: (
    claim: FailedPaymentNotificationClaim,
    errorMessage: string,
  ) => Promise<void>;
  markCustomerNotificationSent: (
    claim: FailedPaymentNotificationClaim,
  ) => Promise<void>;
  notificationsAreConfigured: () => boolean;
  openOperatorTask: (context: FailedPaymentNotificationContext) => Promise<{
    id: string;
    isNew: boolean;
  }>;
  sendCustomerEmail: (input: {
    html: string;
    subject: string;
    text: string;
    to: string;
  }) => Promise<void>;
  writeAudit: (input: {
    action: string;
    entityId: string;
    outcome: "failure" | "success";
    summary: string;
  }) => Promise<void>;
};

export type FailedPaymentNotificationResult = {
  customerEmailSent: boolean;
  customerNotificationClaimed: boolean;
  operatorTaskId: string | null;
};

function serializeError(error: unknown) {
  return error instanceof Error
    ? error.message.slice(0, 180)
    : "Failed payment notification failed.";
}

export async function runFailedPaymentNotificationFlow(
  context: FailedPaymentNotificationContext,
  dependencies: FailedPaymentNotificationDependencies,
): Promise<FailedPaymentNotificationResult> {
  if (!context.outcome.operatorTaskRequired) {
    return {
      customerEmailSent: false,
      customerNotificationClaimed: false,
      operatorTaskId: null,
    };
  }

  const operatorTask = await dependencies.openOperatorTask(context);

  if (!dependencies.notificationsAreConfigured()) {
    await dependencies.writeAudit({
      action: "failed_payment.notification.skipped",
      entityId: context.localPaymentId,
      outcome: "success",
      summary: "Skipped failed-payment customer notification.",
    });

    return {
      customerEmailSent: false,
      customerNotificationClaimed: false,
      operatorTaskId: operatorTask.id,
    };
  }

  const customerEmail = buildFailedPaymentCustomerEmail(context);

  if (!customerEmail.shouldSend || !context.customerEmail) {
    await dependencies.writeAudit({
      action: "failed_payment.notification.skipped",
      entityId: context.localPaymentId,
      outcome: "success",
      summary: "Skipped failed-payment customer notification.",
    });

    return {
      customerEmailSent: false,
      customerNotificationClaimed: false,
      operatorTaskId: operatorTask.id,
    };
  }

  const claim = await dependencies.claimCustomerNotification(context);

  if (!claim.isClaimed) {
    return {
      customerEmailSent: false,
      customerNotificationClaimed: false,
      operatorTaskId: operatorTask.id,
    };
  }

  try {
    await dependencies.sendCustomerEmail({
      html: customerEmail.html,
      subject: customerEmail.subject,
      text: customerEmail.text,
      to: context.customerEmail,
    });
    await dependencies.markCustomerNotificationSent(claim);
    await dependencies.writeAudit({
      action: "failed_payment.notification.sent",
      entityId: context.localPaymentId,
      outcome: "success",
      summary: "Sent failed-payment customer notification.",
    });

    return {
      customerEmailSent: true,
      customerNotificationClaimed: true,
      operatorTaskId: operatorTask.id,
    };
  } catch (error) {
    const errorMessage = serializeError(error);

    await dependencies.markCustomerNotificationFailed(claim, errorMessage);
    await dependencies.writeAudit({
      action: "failed_payment.notification.failed",
      entityId: context.localPaymentId,
      outcome: "failure",
      summary: "Failed to send failed-payment customer notification.",
    });

    throw error;
  }
}
