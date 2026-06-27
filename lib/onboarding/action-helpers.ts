import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";

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
import { getSingleTenantIdOrThrow } from "@/lib/tenants";

export function redirectWithMessage(
  pathname: string,
  options: { error?: string; notice?: string },
): never {
  redirect(
    updateActionPath(pathname, {
      error: options.error,
      notice: options.notice,
    }),
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
) {
  const relation = await getEboekhoudenRelation(relationId);

  if (!shouldPatchEboekhoudenRelation(relation, fields)) {
    return relation;
  }

  await updateEboekhoudenRelation(
    relationId,
    localFieldsToRelationPatch(fields, relation),
  );

  return getEboekhoudenRelation(relationId);
}

export async function getLocalCustomer(customerId: string, mode: "live" | "test") {
  const detail = await getCustomerDetail(customerId, mode);
  return detail?.customer ?? null;
}

export async function assertRelationIsAvailable(
  relationId: number,
  mode: "live" | "test",
  excludeCustomerId?: string,
) {
  const tenantId = await getSingleTenantIdOrThrow();
  const existing = await transaction(async (client) => {
    const result = excludeCustomerId
      ? await client.execute<{ id: string }>(sql`
          select id
          from customers
          where tenant_id = ${tenantId}
            and mode = ${mode}
            and eboekhouden_relation_id = ${relationId}
            and id <> ${excludeCustomerId}
          limit 1
        `)
      : await client.execute<{ id: string }>(sql`
        select id
        from customers
        where tenant_id = ${tenantId}
          and mode = ${mode}
          and eboekhouden_relation_id = ${relationId}
        limit 1
      `);

    return result.rows[0] ?? null;
  });

  if (existing) {
    throw new Error("This e-Boekhouden relation is already linked to another customer.");
  }
}
