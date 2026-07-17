import "server-only";

import type { Payment } from "@mollie/api-client";

import type { MollieMode } from "@/lib/env";
import { getTenantMollieClient, getTenantMollieRequestAuthentication, getTenantMollieRequestContext, isMollieConfigured } from "@/lib/mollie/client";
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

function buildRequestedMollieModeOrder(
  preferredMode?: MollieMode,
  strictMode = false,
): MollieMode[] {
  if (preferredMode && strictMode) {
    return [preferredMode];
  }

  return preferredMode
    ? [preferredMode, preferredMode === "live" ? "test" : "live"]
    : (["live", "test"] satisfies MollieMode[]);
}

async function buildLookupMollieModeOrder(input: {
  preferredMode?: MollieMode;
  strictMode?: boolean;
  tenantId?: string;
}) {
  const { preferredMode, strictMode = false, tenantId } = input;

  if (!tenantId) {
    return buildConfiguredMollieModeOrder({
      isConfigured: isMollieConfigured,
      preferredMode,
      strictMode,
    });
  }

  const orderedModes = buildRequestedMollieModeOrder(preferredMode, strictMode);
  const availableModes: MollieMode[] = [];
  let lastCredentialError: unknown;

  for (const mode of orderedModes) {
    try {
      await getTenantMollieRequestAuthentication(tenantId, mode);
      availableModes.push(mode);
    } catch (error) {
      lastCredentialError = error;
    }
  }

  if (availableModes.length > 0) {
    return availableModes;
  }

  throw lastCredentialError ?? new Error("Tenant Mollie credentials are missing.");
}

export async function findPaymentAcrossModes(
  molliePaymentId: string,
  preferredMode?: MollieMode,
  strictMode = false,
  tenantId?: string,
) {
  const result = await findMollieResourceAcrossModes(
    await buildLookupMollieModeOrder({
      preferredMode,
      strictMode,
      tenantId,
    }),
    async (mode) => {
      const [client, { testmode }] = await Promise.all([
        getTenantMollieClient(tenantId, mode),
        getTenantMollieRequestContext(tenantId, mode),
      ]);
      return client.payments.get(molliePaymentId, { ...(testmode ? { testmode } : {}) });
    },
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
  tenantId?: string,
) {
  const result = await findMollieResourceAcrossModes(
    await buildLookupMollieModeOrder({
      preferredMode,
      strictMode,
      tenantId,
    }),
    async (mode) => {
      const [client, { testmode }] = await Promise.all([
        getTenantMollieClient(tenantId, mode),
        getTenantMollieRequestContext(tenantId, mode),
      ]);
      return client.paymentLinks.get(
        molliePaymentLinkId,
        { ...(testmode ? { testmode } : {}) },
      ) as unknown as Promise<SyncMolliePaymentLink>;
    },
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
  tenantId?: string,
) {
  const result = await findMollieResourceAcrossModes(
    await buildLookupMollieModeOrder({
      preferredMode,
      strictMode,
      tenantId,
    }),
    async (mode) => {
      const client = await getTenantMollieClient(tenantId, mode);
      const { testmode } = await getTenantMollieRequestContext(tenantId, mode);
      const subscription = await client.customerSubscriptions.get(
        mollieSubscriptionId,
        {
          customerId: customerMollieId,
          ...(testmode ? { testmode } : {}),
        },
      );
      const payments = await client.subscriptionPayments.page({
        customerId: customerMollieId,
        subscriptionId: mollieSubscriptionId,
        ...(testmode ? { testmode } : {}),
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
