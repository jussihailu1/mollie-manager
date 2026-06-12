import "server-only";

import type { Payment } from "@mollie/api-client";

import type { MollieMode } from "@/lib/env";
import { getMollieClient, isMollieConfigured } from "@/lib/mollie/client";
import { buildConfiguredMollieModeOrder } from "@/lib/reliability/mollie-mode-selection";
import { findMollieResourceAcrossModes } from "@/lib/reliability/mollie-resource-lookup";
import type { PaymentLinkSyncSource } from "@/lib/reliability/payment-link-sync-record";

export type SyncMolliePaymentLink = {
  createdAt?: string;
  description: string;
  expiresAt?: string;
  getPaymentUrl: () => string;
  getPayments: () => AsyncIterable<Payment>;
  id: string;
  webhookUrl?: string;
} & PaymentLinkSyncSource;

export async function findPaymentAcrossModes(
  molliePaymentId: string,
  preferredMode?: MollieMode,
  strictMode = false,
) {
  const result = await findMollieResourceAcrossModes(
    buildConfiguredMollieModeOrder({
      isConfigured: isMollieConfigured,
      preferredMode,
      strictMode,
    }),
    (mode) => getMollieClient(mode).payments.get(molliePaymentId),
    "Payment was not found in Mollie.",
  );

  return {
    mode: result.mode,
    payment: result.resource,
  };
}

export async function findPaymentLinkAcrossModes(
  molliePaymentLinkId: string,
  preferredMode?: MollieMode,
  strictMode = false,
) {
  const result = await findMollieResourceAcrossModes(
    buildConfiguredMollieModeOrder({
      isConfigured: isMollieConfigured,
      preferredMode,
      strictMode,
    }),
    (mode) =>
      getMollieClient(mode).paymentLinks.get(
        molliePaymentLinkId,
      ) as unknown as Promise<SyncMolliePaymentLink>,
    "Payment link was not found in Mollie.",
  );

  return {
    mode: result.mode,
    paymentLink: result.resource,
  };
}

export async function findSubscriptionAcrossModes(
  mollieSubscriptionId: string,
  customerMollieId: string,
  preferredMode?: MollieMode,
  strictMode = false,
) {
  const result = await findMollieResourceAcrossModes(
    buildConfiguredMollieModeOrder({
      isConfigured: isMollieConfigured,
      preferredMode,
      strictMode,
    }),
    async (mode) => {
      const client = getMollieClient(mode);
      const subscription = await client.customerSubscriptions.get(
        mollieSubscriptionId,
        {
          customerId: customerMollieId,
        },
      );
      const payments = await client.subscriptionPayments.page({
        customerId: customerMollieId,
        subscriptionId: mollieSubscriptionId,
      });

      return {
        payments,
        subscription,
      };
    },
    "Subscription was not found in Mollie.",
  );

  return {
    mode: result.mode,
    ...result.resource,
  };
}
