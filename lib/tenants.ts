import "server-only";

import { sql } from "drizzle-orm";

import { getDb, transaction } from "@/lib/db";

export const LEGACY_DEFAULT_TENANT_ID = "legacy-default";
export const LEGACY_DEFAULT_TENANT_SLUG = "legacy-default";
export const LEGACY_DEFAULT_TENANT_NAME = "Legacy Default Tenant";

export type TenantRow = {
  id: string;
  name: string;
  slug: string;
};

export type TenantAccessRecord = {
  isPlatformOperator: boolean;
  tenantIds: string[];
};

export type ProvisionTenantInput = {
  name: string;
  operatorEmail?: string | null;
  platformOperatorEmail?: string | null;
  slug: string;
  tenantId?: string;
};

function normalizeEmail(email: string | null | undefined) {
  return email?.trim().toLowerCase() ?? null;
}

export async function listTenants() {
  const result = await getDb().execute<TenantRow>(sql`
    select
      id,
      name,
      slug
    from tenants
    order by lower(name), id
  `);

  return result.rows;
}

export async function getTenantAccessForOperatorEmail(
  operatorEmail: string | null | undefined,
) {
  const normalizedEmail = normalizeEmail(operatorEmail);

  if (!normalizedEmail) {
    return {
      isPlatformOperator: false,
      tenantIds: [],
    } satisfies TenantAccessRecord;
  }

  const [tenantResult, platformOperatorResult] = await Promise.all([
    getDb().execute<{ tenantId: string }>(sql`
      select tenant_id as "tenantId"
      from operator_tenant_memberships
      where operator_email = ${normalizedEmail}
      order by created_at asc, id asc
    `),
    getDb().execute<{ id: string }>(sql`
      select id
      from platform_operators
      where operator_email = ${normalizedEmail}
      limit 1
    `),
  ]);

  return {
    isPlatformOperator: Boolean(platformOperatorResult.rows[0]),
    tenantIds: tenantResult.rows.map((row) => row.tenantId),
  } satisfies TenantAccessRecord;
}

export async function requireTenantAccessForOperatorEmail(
  operatorEmail: string | null | undefined,
) {
  const access = await getTenantAccessForOperatorEmail(operatorEmail);

  if (!access.isPlatformOperator && access.tenantIds.length === 0) {
    throw new Error("Tenant membership is required for operator access.");
  }

  return access;
}

export async function getSingleTenantIdOrThrow() {
  const tenants = await listTenants();

  if (tenants.length !== 1) {
    throw new Error(
      "Explicit tenant context is required once more than one tenant exists.",
    );
  }

  return tenants[0]!.id;
}

export async function provisionTenant(input: ProvisionTenantInput) {
  const tenantId = input.tenantId?.trim() || crypto.randomUUID();
  const operatorEmail = normalizeEmail(input.operatorEmail);
  const platformOperatorEmail = normalizeEmail(input.platformOperatorEmail);

  await transaction(async (tx) => {
    await tx.execute(sql`
      insert into tenants (
        id,
        slug,
        name,
        created_at,
        updated_at
      ) values (
        ${tenantId},
        ${input.slug},
        ${input.name},
        now(),
        now()
      )
      on conflict (id)
      do update set
        slug = excluded.slug,
        name = excluded.name,
        updated_at = now()
    `);

    if (operatorEmail) {
      await tx.execute(sql`
        insert into operator_tenant_memberships (
          id,
          tenant_id,
          operator_email,
          created_at,
          updated_at
        ) values (
          ${crypto.randomUUID()},
          ${tenantId},
          ${operatorEmail},
          now(),
          now()
        )
        on conflict (tenant_id, operator_email)
        do update set
          updated_at = now()
      `);
    }

    if (platformOperatorEmail) {
      await tx.execute(sql`
        insert into platform_operators (
          id,
          operator_email,
          created_at,
          updated_at
        ) values (
          ${crypto.randomUUID()},
          ${platformOperatorEmail},
          now(),
          now()
        )
        on conflict (operator_email)
        do update set
          updated_at = now()
      `);
    }
  });

  return tenantId;
}
