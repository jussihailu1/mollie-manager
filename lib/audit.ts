import "server-only";

import type { PoolClient } from "pg";

import { requireViewerSession } from "@/lib/auth/session";
import { query } from "@/lib/db";
import type { MollieMode } from "@/lib/env";

type AuditInput = {
  action: string;
  details?: Record<string, unknown>;
  entityId: string;
  entityType: string;
  mode?: MollieMode;
  outcome: "failure" | "success";
  summary: string;
};

type AuditActor =
  | {
      email?: string | null;
      kind: "system";
    }
  | {
      email?: string | null;
      kind: "user";
    };

export async function writeAuditLog(
  input: AuditInput,
  client?: PoolClient,
  actor?: AuditActor,
) {
  let actorEmail = actor?.email ?? null;
  let actorKind: AuditActor["kind"] = actor?.kind ?? "user";

  if (!actor) {
    const session = await requireViewerSession();
    actorEmail = session.user.email ?? null;
    actorKind = "user";
  }

  const params = [
    crypto.randomUUID(),
    actorKind,
    actorEmail,
    input.action,
    input.entityType,
    input.entityId,
    input.mode ?? null,
    input.outcome,
    input.summary,
    JSON.stringify(input.details ?? {}),
  ];

  const statement = `
    insert into audit_logs (
      id,
      actor_kind,
      actor_email,
      action,
      entity_type,
      entity_id,
      mode,
      outcome,
      summary,
      details
    ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
  `;

  if (client) {
    await client.query(statement, params);
    return;
  }

  await query(statement, params);
}
