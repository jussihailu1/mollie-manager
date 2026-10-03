import type { MollieMode } from "@/lib/env";
import type { WebhookResourceContext } from "./webhook-processing";

export type WebhookPaymentIdentity = {
  id: string;
  mode: MollieMode;
  customerId?: string;
  subscriptionId?: string;
  profileId?: string;
};

// The signal and its metadata never establish ownership. Only a provider read
// using tenant credentials and matching managed provider IDs can do that.
export async function discoverWebhookPaymentContext(
  resourceId: string,
  dependencies: {
    candidates: WebhookResourceContext[];
    fetchPayment: (context: WebhookResourceContext) => Promise<WebhookPaymentIdentity | null>;
    isManagedPayment: (payment: WebhookPaymentIdentity, context: WebhookResourceContext) => Promise<boolean>;
  },
): Promise<WebhookResourceContext | null> {
  const matches: WebhookResourceContext[] = [];
  for (const context of dependencies.candidates) {
    const payment = await dependencies.fetchPayment(context);
    if (!payment || payment.id !== resourceId || payment.mode !== context.mode || !payment.customerId) continue;
    if (await dependencies.isManagedPayment(payment, context)) matches.push(context);
  }
  if (matches.length > 1) throw new Error("Webhook payment ownership is ambiguous.");
  return matches[0] ?? null;
}
