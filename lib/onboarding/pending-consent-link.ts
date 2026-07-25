import "server-only";

import { sql } from "drizzle-orm";

import { writeAuditLog } from "@/lib/audit";
import { getDb, transaction } from "@/lib/db";
import type { MollieMode } from "@/lib/env";
import { getTenantMollieClient } from "@/lib/mollie/client";
import { subscriptionConsentPlanSnapshotSchema } from "@/lib/subscription-consent";

type PendingConsentLinkRow = {
  consentId: string;
  firstPaymentExists: boolean;
  molliePaymentLinkId: string | null;
  paymentLinkId: string;
  planSnapshot: unknown;
};

export type PendingConsentLink = {
  consentId: string;
  paymentLinkId: string;
  planSnapshot: ReturnType<typeof subscriptionConsentPlanSnapshotSchema.parse>;
};

export type PendingConsentLinkActor = {
  email?: string | null;
  kind: "user";
};

export function isMollieResourceNotFound(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    (error as { statusCode?: unknown }).statusCode === 404
  );
}

async function findPendingConsentLink(
  customerId: string,
  mode: MollieMode,
  tenantId: string,
) {
  const result = await getDb().execute<PendingConsentLinkRow>(sql`
    select
      soc.id as "consentId",
      soc.payment_link_id as "paymentLinkId",
      pl.mollie_payment_link_id as "molliePaymentLinkId",
      soc.plan_snapshot as "planSnapshot",
      exists(
        select 1
        from payments p
        where p.customer_id = soc.customer_id
          and p.tenant_id = soc.tenant_id
          and p.mode = soc.mode
          and p.payment_type = 'first'
      ) as "firstPaymentExists"
    from subscription_onboarding_consents soc
    inner join payment_links pl
      on pl.id = soc.payment_link_id
      and pl.tenant_id = soc.tenant_id
      and pl.mode = soc.mode
    inner join customers c
      on c.id = soc.customer_id
      and c.tenant_id = soc.tenant_id
      and c.mode = soc.mode
    where soc.customer_id = ${customerId}
      and soc.tenant_id = ${tenantId}
      and soc.mode = ${mode}
      and soc.accepted_at is null
      and c.archived_at is null
      and c.mollie_customer_id is not null
    order by soc.created_at desc
    limit 1
  `);

  return result.rows[0] ?? null;
}

export async function getPendingConsentLink(
  customerId: string,
  mode: MollieMode,
  tenantId: string,
): Promise<PendingConsentLink | null> {
  const pending = await findPendingConsentLink(customerId, mode, tenantId);

  if (!pending || pending.firstPaymentExists) {
    return null;
  }

  const parsedPlanSnapshot = subscriptionConsentPlanSnapshotSchema.safeParse(pending.planSnapshot);

  if (!parsedPlanSnapshot.success) {
    throw new Error("Stored consent snapshot is invalid.");
  }

  return {
    consentId: pending.consentId,
    paymentLinkId: pending.paymentLinkId,
    planSnapshot: parsedPlanSnapshot.data,
  };
}

export async function removePendingConsentLink(input: {
  actor: PendingConsentLinkActor;
  customerId: string;
  mode: MollieMode;
  reason: "deleted" | "replaced";
  tenantId: string;
}) {
  const pending = await findPendingConsentLink(input.customerId, input.mode, input.tenantId);

  if (!pending) {
    throw new Error("No pending consent link is available for this customer.");
  }

  if (pending.firstPaymentExists) {
    throw new Error("A first payment already exists for this customer.");
  }

  let mollieLinkAlreadyMissing = false;

  if (pending.molliePaymentLinkId) {
    const mollie = await getTenantMollieClient(input.tenantId, input.mode);

    try {
      await mollie.paymentLinks.delete(pending.molliePaymentLinkId);
    } catch (error) {
      if (!isMollieResourceNotFound(error)) {
        throw error;
      }

      mollieLinkAlreadyMissing = true;
    }
  }

  await transaction(async (client) => {
    await client.execute(sql`
      delete from payment_links
      where id = ${pending.paymentLinkId}
        and customer_id = ${input.customerId}
        and tenant_id = ${input.tenantId}
        and mode = ${input.mode}
    `);

    await writeAuditLog(
      {
        action: input.reason === "replaced" ? "consent_link.replace" : "consent_link.delete",
        details: {
          consentId: pending.consentId,
          mollieLinkAlreadyMissing,
          paymentLinkId: pending.paymentLinkId,
        },
        entityId: input.customerId,
        entityType: "customer",
        mode: input.mode,
        outcome: "success",
        summary:
          input.reason === "replaced"
            ? "Revoked a pending consent link before creating a replacement."
            : "Revoked and removed a pending consent link.",
      },
      client,
      input.actor,
    );
  });
}
