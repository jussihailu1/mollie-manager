import { sql } from "drizzle-orm";

import { redirectWithActionFeedback } from "@/lib/action-feedback";
import { transaction } from "@/lib/db";
import {
  getEboekhoudenRelation,
  toPublicEboekhoudenError,
  updateEboekhoudenRelation,
} from "@/lib/eboekhouden/client";
import {
  localFieldsToRelationPatch,
  type LocalRelationFields,
} from "@/lib/eboekhouden/relation-mapping";
import { getCustomerDetail } from "@/lib/onboarding/data";
import { updateActionPath } from "@/lib/onboarding/action-path";
import {
  shouldPatchEboekhoudenRelation,
} from "@/lib/onboarding/customer-relation-fields";

export async function redirectWithMessage(
  pathname: string,
  options: { error?: string; notice?: string },
): Promise<never> {
  return redirectWithActionFeedback(
    updateActionPath(pathname, { error: null, notice: null }),
    options.error
      ? { kind: "error", message: options.error }
      : options.notice
        ? { kind: "success", message: options.notice }
        : undefined,
  );
}

export function serializeError(error: unknown) {
  if (error instanceof Error) {
    return error.message.slice(0, 180);
  }

  return "Something went wrong while talking to Mollie.";
}

export function serializeIntegrationError(error: unknown) {
  const eboekhoudenError = toPublicEboekhoudenError(error);

  if (eboekhoudenError.code !== "unknown_error") {
    return eboekhoudenError.message.slice(0, 180);
  }

  return serializeError(error);
}

export async function updateRelationFromLocalFields(
  relationId: number,
  fields: LocalRelationFields,
  tenantId: string,
) {
  const relation = await getEboekhoudenRelation(relationId, tenantId);

  if (!shouldPatchEboekhoudenRelation(relation, fields)) {
    return relation;
  }

  await updateEboekhoudenRelation(
    relationId,
    localFieldsToRelationPatch(fields, relation),
    tenantId,
  );

  return getEboekhoudenRelation(relationId, tenantId);
}

export async function getLocalCustomer(
  customerId: string,
  mode: "live" | "test",
  tenantId?: string,
) {
  const detail = await getCustomerDetail(customerId, mode, tenantId);
  return detail?.customer ?? null;
}

export async function assertRelationIsAvailable(
  relationId: number,
  mode: "live" | "test",
  excludeCustomerId?: string,
  tenantId?: string,
) {
  if (!tenantId) {
    throw new Error("Tenant id is required.");
  }

  const resolvedTenantId = tenantId;
  const existing = await transaction(async (client) => {
    const result = excludeCustomerId
      ? await client.execute<{ id: string }>(sql`
          select customer_id as id
          from customer_accounting_links
          where tenant_id = ${resolvedTenantId}
            and mode = ${mode}
            and provider = 'eboekhouden'
            and provider_customer_id = ${String(relationId)}
            and customer_id <> ${excludeCustomerId}
          limit 1
        `)
      : await client.execute<{ id: string }>(sql`
        select customer_id as id
        from customer_accounting_links
        where tenant_id = ${resolvedTenantId}
          and mode = ${mode}
          and provider = 'eboekhouden'
          and provider_customer_id = ${String(relationId)}
        limit 1
      `);

    return result.rows[0] ?? null;
  });

  if (existing) {
    throw new Error("This e-Boekhouden relation is already linked to another customer.");
  }
}
