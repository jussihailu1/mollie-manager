import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";

import { getDb, transaction } from "@/lib/db";
import { TenantMollieCredentialError } from "@/lib/mollie/tenant-credentials";

const STATE_TTL_MS = 10 * 60 * 1000;

function digest(state: string) {
  return createHash("sha256").update(state).digest("hex");
}

export async function createMollieOAuthState(input: {
  tenantId: string;
  actorEmail: string;
}) {
  if (!input.tenantId || !input.actorEmail) {
    throw new TenantMollieCredentialError("Explicit tenant and actor context are required.");
  }

  const state = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + STATE_TTL_MS).toISOString();

  await getDb().execute(sql`
    insert into mollie_oauth_states (id, state_digest, tenant_id, actor_email, expires_at)
    values (${randomUUID()}, ${digest(state)}, ${input.tenantId}, ${input.actorEmail.toLowerCase()}, ${expiresAt})
  `);

  return state;
}

export async function consumeMollieOAuthState(input: {
  state: string;
  actorEmail: string;
}) {
  const actorEmail = input.actorEmail.trim().toLowerCase();
  if (!input.state || !actorEmail) {
    throw new TenantMollieCredentialError("Mollie connect state is invalid or expired.");
  }

  return transaction(async (tx) => {
    const result = await tx.execute<{ tenantId: string }>(sql`
      update mollie_oauth_states
      set consumed_at = now()
      where state_digest = ${digest(input.state)}
        and actor_email = ${actorEmail}
        and consumed_at is null
        and expires_at > now()
      returning tenant_id as "tenantId"
    `);
    const row = result.rows[0];
    if (!row) {
      throw new TenantMollieCredentialError("Mollie connect state is invalid or expired.");
    }
    return row;
  });
}
