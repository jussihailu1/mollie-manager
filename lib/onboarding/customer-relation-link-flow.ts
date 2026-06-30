import { sql } from "drizzle-orm";

import { writeAuditLog } from "@/lib/audit";
import { normalizeCustomerNoteBody } from "@/lib/customer-note-policy";
import { transaction } from "@/lib/db";
import type { MollieMode } from "@/lib/env";
import { assertRelationIsAvailable, getLocalCustomer, updateRelationFromLocalFields } from "@/lib/onboarding/action-helpers";
import { toCustomerRelationFields } from "@/lib/onboarding/customer-relation-fields";
import { requireCustomerTenantId } from "@/lib/tenant-ownership";

type CustomerRelationLinkActor = {
  email?: string | null;
  kind: "user";
};

type CustomerRelationLinkInput = {
  actor: CustomerRelationLinkActor;
  customerId: string;
  fields: {
    address?: string;
    businessName: string;
    contactName: string;
    email: string;
    eboekhoudenRelationId: number;
    notes?: string;
    phone?: string;
  };
  mode: MollieMode;
  tenantId?: string;
};

type CustomerRelationLinkResult =
  | {
      status: "linked";
    }
  | {
      status: "archived";
    }
  | {
      status: "not_found";
    };

export async function linkCustomerToEboekhoudenRelation(
  input: CustomerRelationLinkInput,
): Promise<CustomerRelationLinkResult> {
  const customer = await getLocalCustomer(input.customerId, input.mode, input.tenantId);

  if (!customer) {
    return {
      status: "not_found",
    };
  }

  if (customer.archivedAt) {
    return {
      status: "archived",
    };
  }

  await assertRelationIsAvailable(
    input.fields.eboekhoudenRelationId,
    input.mode,
    customer.id,
    input.tenantId,
  );

  const tenantId = input.tenantId ?? (await requireCustomerTenantId(customer.id));
  const relationFields = toCustomerRelationFields(input.fields);
  const linkedRelation = await updateRelationFromLocalFields(
    input.fields.eboekhoudenRelationId,
    relationFields,
    tenantId,
  );
  const normalizedNote = normalizeCustomerNoteBody(input.fields.notes ?? "");

  await transaction(async (client) => {
    await client.execute(sql`
      update customers
      set
        eboekhouden_relation_id = ${linkedRelation.id},
        eboekhouden_relation_code = ${linkedRelation.code ?? null},
        eboekhouden_link_status = 'linked',
        eboekhouden_synced_at = now(),
        eboekhouden_relation_snapshot = ${JSON.stringify(linkedRelation)}::jsonb,
        full_name = ${input.fields.businessName},
        email = ${input.fields.email},
        metadata = metadata || ${JSON.stringify({
          address: input.fields.address ?? null,
          businessName: input.fields.businessName,
          contactName: input.fields.contactName,
          phone: input.fields.phone ?? null,
        })}::jsonb,
        updated_at = now(),
        last_synced_at = now()
      where id = ${customer.id}
        and mode = ${input.mode}
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
          ${customer.id},
          ${normalizedNote},
          'operator'
        )
      `);
    }

    await writeAuditLog(
      {
        action: "customer.eboekhouden.link",
        details: {
          eboekhoudenRelationId: linkedRelation.id,
          localCustomerId: customer.id,
        },
        entityId: customer.id,
        entityType: "customer",
        mode: input.mode,
        outcome: "success",
        summary: "Linked local customer to an e-Boekhouden relation.",
      },
      client,
      input.actor,
    );
  });

  return {
    status: "linked",
  };
}
