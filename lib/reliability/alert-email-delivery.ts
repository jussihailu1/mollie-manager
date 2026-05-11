import type { AlertEmailContent } from "@/lib/reliability/alert-email-template";

type DeliveryResult = {
  delivered: boolean;
  error: string | null;
};

type AlertDeliveryInput = {
  alertId: string;
  message: string;
  title: string;
};

type AlertDeliveryDependencies = {
  composeAlertEmail: (input: AlertDeliveryInput) => Promise<AlertEmailContent>;
  markAlertEmailSent: (alertId: string) => Promise<void>;
  notificationsAreConfigured: () => boolean;
  sendNotificationEmail: (input: {
    html?: string;
    subject: string;
    text: string;
  }) => Promise<void>;
};

function toErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message.slice(0, 180);
  }

  return "Email delivery failed.";
}

export async function deliverAlertEmailWithDependencies(
  input: AlertDeliveryInput,
  dependencies: AlertDeliveryDependencies,
): Promise<DeliveryResult> {
  if (!dependencies.notificationsAreConfigured()) {
    return {
      delivered: false,
      error: "Notifications are not configured.",
    };
  }

  try {
    const content = await dependencies.composeAlertEmail(input);

    await dependencies.sendNotificationEmail({
      html: content.html,
      subject: `[Mollie Manager] ${input.title}`,
      text: content.text,
    });

    await dependencies.markAlertEmailSent(input.alertId);
  } catch (error) {
    return {
      delivered: false,
      error: toErrorMessage(error),
    };
  }

  return {
    delivered: true,
    error: null,
  };
}
