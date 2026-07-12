import { Locale } from "@mollie/api-client";
import { sql } from "drizzle-orm";

import { writeAuditLog } from "@/lib/audit";
import { upsertCustomerAccountingLink } from "@/lib/customer-accounting-links";
import { normalizeCustomerNoteBody } from "@/lib/customer-note-policy";
import { transaction } from "@/lib/db";
import type { MollieMode } from "@/lib/env";
import { getTenantMollieClient } from "@/lib/mollie/client";
import { assertRelationIsAvailable, updateRelationFromLocalFields } from "@/lib/onboarding/action-helpers";
import { toCustomerRelationFields } from "@/lib/onboarding/customer-relation-fields";

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
  const tenantId = input.tenantId;

  if (!tenantId) {
    throw new Error("Tenant id is required.");
  }

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
      ? await updateRelationFromLocalFields(
          relationIdToLink,
          relationFields,
          tenantId,
        )
      : null;

  const mollie = await getTenantMollieClient(tenantId, input.mode);
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

    await upsertCustomerAccountingLink(
      {
        customerId: localCustomerId,
        linkStatus: linkedRelation ? "linked" : "unlinked",
        mode: input.mode,
        provider: "eboekhouden",
        providerCustomerCode: linkedRelation?.code ?? null,
        providerCustomerId: linkedRelation?.id ? String(linkedRelation.id) : null,
        providerSnapshot: (linkedRelation ?? {}) as Record<string, unknown>,
        syncedAt: linkedRelation ? new Date().toISOString() : null,
        tenantId,
      },
      client,
    );

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
