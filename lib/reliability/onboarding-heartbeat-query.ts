import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { onboardingHeartbeatIssues } from "./onboarding-heartbeat";

export async function checkOnboardingRecoveryHeartbeat(tenant: { id: string; name: string }) {
  const result = await getDb().execute<{ latest: string | null }>(sql`
    select max(created_at)::text as latest from audit_logs
    where action = 'onboarding.recovery' and entity_type = 'tenant_onboarding_recovery'
      and entity_id = ${tenant.id} and mode = 'live' and outcome = 'success'
      and details ->> 'trigger' = 'schedule'
  `);
  return onboardingHeartbeatIssues({ tenantId: tenant.id, tenantName: tenant.name, lastScheduledSuccessAt: result.rows[0]?.latest ?? null });
}
