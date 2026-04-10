import "server-only";

import { sql } from "drizzle-orm";

import { requireViewerSession } from "@/lib/auth/session";
import { getDb, type DbClient } from "@/lib/db";
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
  client?: DbClient,
  actor?: AuditActor,
) {
  let actorEmail = actor?.email ?? null;
  let actorKind: AuditActor["kind"] = actor?.kind ?? "user";

  if (!actor) {
    const session = await requireViewerSession();
    actorEmail = session.user.email ?? null;
    actorKind = "user";
  }

  const db = client ?? getDb();

  await db.execute(sql`
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
    ) values (
      ${crypto.randomUUID()},
      ${actorKind},
      ${actorEmail},
      ${input.action},
      ${input.entityType},
      ${input.entityId},
      ${input.mode ?? null},
      ${input.outcome},
      ${input.summary},
      ${JSON.stringify(input.details ?? {})}::jsonb
    )
  `);
}
