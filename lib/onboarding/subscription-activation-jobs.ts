import "server-only";

import { sql } from "drizzle-orm";

import { writeAuditLog } from "@/lib/audit";
import { getDb } from "@/lib/db";
import type { MollieMode } from "@/lib/env";
import { attemptSubscriptionActivation } from "@/lib/onboarding/subscription-activation";
import { queueSubscriptionActivationExhaustedNotifications } from "@/lib/onboarding/subscription-activation-notifications";
import { openAlert } from "@/lib/reliability/alerts";
import {
  ACTIVATION_RECOVERY_WINDOW_MS,
  getSubscriptionActivationRetryDelay,
} from "@/lib/onboarding/subscription-activation-retry-policy";

type Job = { id: string; customerId: string; consentId: string; attemptCount: number; expiresAt: string; claimToken: string };

export async function queueSubscriptionActivationForCustomer(input: { customerId: string; mode: MollieMode; tenantId: string }) {
  const db = getDb();
  const consent = await db.execute<{ consentId: string }>(sql`
    select id as "consentId" from subscription_onboarding_consents
    where customer_id = ${input.customerId} and tenant_id = ${input.tenantId} and mode = ${input.mode} and accepted_at is not null
    order by accepted_at desc limit 1
  `);
  const consentId = consent.rows[0]?.consentId;
  if (!consentId) return null;
  const id = crypto.randomUUID();
  await db.execute(sql`
    insert into subscription_activation_jobs (id, tenant_id, customer_id, consent_id, mode, expires_at)
    values (${id}, ${input.tenantId}, ${input.customerId}, ${consentId}, ${input.mode}, now() + (${ACTIVATION_RECOVERY_WINDOW_MS} * interval '1 millisecond'))
    on conflict (tenant_id, mode, consent_id) do update set
      next_attempt_at = case when subscription_activation_jobs.status in ('pending', 'retrying') then least(subscription_activation_jobs.next_attempt_at, now()) else subscription_activation_jobs.next_attempt_at end,
      updated_at = now()
  `);
  return id;
}

export async function processSubscriptionActivationJobsBatch(input: { limit: number; mode: MollieMode; tenantId: string }) {
  const db = getDb();
  const token = crypto.randomUUID();
  const claimed = await db.execute<Job>(sql`
    with candidates as (
      select id from subscription_activation_jobs where tenant_id = ${input.tenantId} and mode = ${input.mode}
        and status in ('pending', 'retrying') and next_attempt_at <= now() order by next_attempt_at asc limit ${input.limit} for update skip locked
    ) update subscription_activation_jobs j set status = 'processing', claim_token = ${token}, claimed_at = now(), attempt_count = j.attempt_count + 1, updated_at = now()
    from candidates c where j.id = c.id
    returning j.id, j.customer_id as "customerId", j.consent_id as "consentId", j.attempt_count as "attemptCount", j.expires_at as "expiresAt", j.claim_token as "claimToken"
  `);
  let activatedCount = 0; let exhaustedCount = 0; let retriedCount = 0;
  for (const job of claimed.rows) {
    const result = await attemptSubscriptionActivation({ actor: { kind: "system" }, customerId: job.customerId, mode: input.mode, tenantId: input.tenantId, trigger: "auto" });
    if (result.status === "created" || result.status === "already_exists") {
      await db.execute(sql`update subscription_activation_jobs set status = 'succeeded', subscription_id = ${result.subscriptionId}, claim_token = null, updated_at = now() where id = ${job.id} and claim_token = ${job.claimToken}`);
      activatedCount += 1;
      continue;
    }
    const error = result.status === "failed" ? result.message : result.reason;
    if (Date.parse(job.expiresAt) <= Date.now()) {
      await db.execute(sql`update subscription_activation_jobs set status = 'exhausted', last_error_message = ${error.slice(0, 180)}, claim_token = null, updated_at = now() where id = ${job.id} and claim_token = ${job.claimToken}`);
      const alert = await openAlert({ customerId: job.customerId, message: "Automatic subscription activation could not be completed within 24 hours. Review the customer and Mollie connection.", payload: { consentId: job.consentId, jobId: job.id }, severity: "warning", tenantId: input.tenantId, title: "Subscription activation requires review" });
      if (alert.isNew) await queueSubscriptionActivationExhaustedNotifications({ customerId: job.customerId, eventKey: `job:${job.id}`, jobId: job.id, mode: input.mode, tenantId: input.tenantId });
      await writeAuditLog({ action: "subscription.activation_exhausted", details: { jobId: job.id }, entityId: job.customerId, entityType: "customer", mode: input.mode, outcome: "failure", summary: "Automatic subscription activation exhausted its recovery window." }, undefined, { kind: "system" });
      exhaustedCount += alert.isNew ? 1 : 0;
      continue;
    }
    const delay = getSubscriptionActivationRetryDelay(job.attemptCount);
    await db.execute(sql`update subscription_activation_jobs set status = 'retrying', last_error_message = ${error.slice(0, 180)}, next_attempt_at = now() + (${delay} * interval '1 millisecond'), claim_token = null, updated_at = now() where id = ${job.id} and claim_token = ${job.claimToken}`);
    retriedCount += 1;
  }
  return { activatedCount, attemptedCount: claimed.rows.length, exhaustedCount, retriedCount };
}
