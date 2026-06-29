import { Locale } from "@mollie/api-client";
import { sql } from "drizzle-orm";

import { writeAuditLog } from "@/lib/audit";
import { normalizeCustomerNoteBody } from "@/lib/customer-note-policy";
import { transaction } from "@/lib/db";
import type { MollieMode } from "@/lib/env";
import { getMollieClient } from "@/lib/mollie/client";
import { assertRelationIsAvailable, updateRelationFromLocalFields } from "@/lib/onboarding/action-helpers";
import { toCustomerRelationFields } from "@/lib/onboarding/customer-relation-fields";
import { getSingleTenantIdOrThrow } from "@/lib/tenants";

type CreateCustomerFlowInput = {
  address?: string;
  businessName: string;
  contactName: string;
  email: string;
  eboekhoudenRelationId?: number;
  notes?: string;
  phone?: string;
  returnTo: string;
  source: "local" | "eboekhouden";
};

export async function createCustomerFlow(input: {
  input: CreateCustomerFlowInput;
  mode: MollieMode;
  tenantId?: string;
}) {
  const tenantId = input.tenantId ?? (await getSingleTenantIdOrThrow());
  const localCustomerId = crypto.randomUUID();
  const relationFields = toCustomerRelationFields(input.input);
  const relationIdToLink =
    input.input.source === "eboekhouden"
      ? input.input.eboekhoudenRelationId
      : undefined;
  const normalizedNote = normalizeCustomerNoteBody(input.input.notes ?? "");

  if (relationIdToLink) {
    await assertRelationIsAvailable(relationIdToLink, input.mode, undefined, tenantId);
  }

  const linkedRelation =
    relationIdToLink
      ? await updateRelationFromLocalFields(relationIdToLink, relationFields)
      : null;

  const mollie = getMollieClient(input.mode);
  const createdCustomer = await mollie.customers.create({
    email: input.input.email,
    idempotencyKey: crypto.randomUUID(),
    locale: Locale.nl_NL,
    metadata: {
      address: input.input.address ?? null,
      businessName: input.input.businessName,
      contactName: input.input.contactName,
      localCustomerId,
      phone: input.input.phone ?? null,
    },
    name: input.input.businessName,
  });

  await transaction(async (client) => {
    await client.execute(sql`
      insert into customers (
        id,
        tenant_id,
        mode,
        mollie_customer_id,
        eboekhouden_relation_id,
        eboekhouden_relation_code,
        eboekhouden_link_status,
        eboekhouden_synced_at,
        eboekhouden_relation_snapshot,
        full_name,
        email,
        locale,
        metadata,
        created_at,
        updated_at,
        last_synced_at
      ) values (
        ${localCustomerId},
        ${tenantId},
        ${input.mode},
        ${createdCustomer.id},
        ${linkedRelation?.id ?? null},
        ${linkedRelation?.code ?? null},
        ${linkedRelation ? "linked" : "unlinked"}::eboekhouden_link_status,
        ${linkedRelation ? sql`now()` : null},
        ${JSON.stringify(linkedRelation ?? {})}::jsonb,
        ${input.input.businessName},
        ${input.input.email},
        ${createdCustomer.locale ?? "nl_NL"},
        ${JSON.stringify({
          address: input.input.address ?? null,
          businessName: input.input.businessName,
          contactName: input.input.contactName,
          mollieCreatedAt: createdCustomer.createdAt,
          phone: input.input.phone ?? null,
        })}::jsonb,
        now(),
        now(),
        now()
      )
    `);

    if (normalizedNote) {
      await client.execute(sql`
        insert into customer_notes (
          id,
          tenant_id,
          mode,
          customer_id,
          body,
          source
        ) values (
          ${crypto.randomUUID()},
          ${tenantId},
          ${input.mode},
          ${localCustomerId},
          ${normalizedNote},
          'operator'
        )
      `);
    }

    await writeAuditLog(
      {
        action: linkedRelation ? "customer.create_from_eboekhouden" : "customer.create",
        details: {
          eboekhoudenRelationId: linkedRelation?.id ?? null,
          localCustomerId,
          mollieCustomerId: createdCustomer.id,
        },
        entityId: localCustomerId,
        entityType: "customer",
        mode: input.mode,
        outcome: "success",
        summary: linkedRelation
          ? "Imported an e-Boekhouden relation, created a Mollie customer, and stored the local bridge."
          : "Created customer in Mollie and stored it locally.",
      },
      client,
    );
  });

  return {
    linkedRelation,
    localCustomerId,
  };
}
