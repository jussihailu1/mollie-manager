import "server-only";

import { sql } from "drizzle-orm";

import { writeAuditLog } from "@/lib/audit";
import { getDb } from "@/lib/db";
import type { MollieMode } from "@/lib/env";
import { attemptSubscriptionActivation } from "@/lib/onboarding/subscription-activation";
import { queueSubscriptionActivationExhaustedNotifications } from "@/lib/onboarding/subscription-activation-notifications";
import { syncPaymentLinkByMollieId } from "@/lib/reliability/sync";
import { openAlert } from "@/lib/reliability/alerts";
import {
  ACTIVATION_RECOVERY_WINDOW_MS,
  getSubscriptionActivationRetryDelay,
} from "@/lib/onboarding/subscription-activation-retry-policy";

type Job = { id: string; customerId: string; consentId: string; attemptCount: number; expiresAt: string; claimToken: string };

export async function queueSubscriptionActivationForCustomer(input: { customerId: string; mode: MollieMode; tenantId: string }) {
  const db = getDb();
  const consent = await db.execute<{ consentId: string }>(sql`
    select soc.id as "consentId" from subscription_onboarding_consents soc
    join payment_links pl on pl.id = soc.payment_link_id and pl.tenant_id = soc.tenant_id and pl.mode = soc.mode
    where soc.customer_id = ${input.customerId} and soc.tenant_id = ${input.tenantId} and soc.mode = ${input.mode} and soc.accepted_at is not null
      and pl.mollie_status = 'paid'
    order by soc.accepted_at desc limit 1
  `);
  const consentId = consent.rows[0]?.consentId;
  if (!consentId) return null;
  const id = crypto.randomUUID();
  await db.execute(sql`
    insert into subscription_activation_jobs (id, tenant_id, customer_id, consent_id, mode, expires_at)
    values (${id}, ${input.tenantId}, ${input.customerId}, ${consentId}, ${input.mode}, now() + (${ACTIVATION_RECOVERY_WINDOW_MS} * interval '1 millisecond'))
    on conflict (tenant_id, mode, consent_id) do nothing
  `);
  return id;
}

export async function processSubscriptionActivationJobsBatch(input: { limit: number; mode: MollieMode; tenantId: string }) {
  const db = getDb();
  const token = crypto.randomUUID();
  const claimed = await db.execute<Job>(sql`
    with candidates as (
      select id from subscription_activation_jobs where tenant_id = ${input.tenantId} and mode = ${input.mode}
        and ((status in ('pending', 'retrying') and next_attempt_at <= now())
          or (status = 'processing' and claimed_at < now() - interval '10 minutes')) order by next_attempt_at asc limit ${input.limit} for update skip locked
    ) update subscription_activation_jobs j set status = 'processing', claim_token = ${token}, claimed_at = now(), attempt_count = j.attempt_count + 1, updated_at = now()
    from candidates c where j.id = c.id
    returning j.id, j.customer_id as "customerId", j.consent_id as "consentId", j.attempt_count as "attemptCount", j.expires_at as "expiresAt", j.claim_token as "claimToken"
  `);
  let activatedCount = 0; let exhaustedCount = 0; let retriedCount = 0;
  for (const job of claimed.rows) {
    let result: Awaited<ReturnType<typeof attemptSubscriptionActivation>>;
    try {
      const link = await db.execute<{ mollieId: string }>(sql`
        select pl.mollie_payment_link_id as "mollieId" from subscription_onboarding_consents soc
        join payment_links pl on pl.id = soc.payment_link_id and pl.tenant_id = soc.tenant_id and pl.mode = soc.mode
        where soc.id = ${job.consentId} and soc.customer_id = ${job.customerId} and soc.tenant_id = ${input.tenantId} and soc.mode = ${input.mode}
      `);
      if (!link.rows[0]) throw new Error("Activation consent link missing.");
      await syncPaymentLinkByMollieId(link.rows[0].mollieId, { tenantId: input.tenantId, preferredMode: input.mode, strictMode: true, reconciliationMode: "sync_only" });
      result = await attemptSubscriptionActivation({ actor: { kind: "system" }, customerId: job.customerId, consentId: job.consentId, mode: input.mode, tenantId: input.tenantId, trigger: "auto" });
    } catch (error) {
      result = { status: "failed", firstPaymentMode: null, message: error instanceof Error ? error.message.slice(0, 180) : "Activation recovery failed." };
    }
    if (result.status === "created" || result.status === "already_exists") {
      await db.execute(sql`update subscription_activation_jobs set status = 'succeeded', subscription_id = ${result.subscriptionId}, claim_token = null, updated_at = now() where id = ${job.id} and claim_token = ${job.claimToken}`);
      await completeSubscriptionActivationJob({ ...input, customerId: job.customerId, subscriptionId: result.subscriptionId });
      activatedCount += 1;
      continue;
    }
    const error = result.status === "failed" ? result.message : result.reason;
    if (Date.parse(job.expiresAt) <= Date.now()) {
      const alert = await openAlert({ customerId: job.customerId, message: "Automatic subscription activation could not be completed within 24 hours. Review the customer and Mollie connection.", payload: { consentId: job.consentId, jobId: job.id }, severity: "warning", tenantId: input.tenantId, title: "Subscription activation requires review" });
      await queueSubscriptionActivationExhaustedNotifications({ customerId: job.customerId, eventKey: `job:${job.id}`, jobId: job.id, mode: input.mode, tenantId: input.tenantId });
      await writeAuditLog({ action: "subscription.activation_exhausted", details: { jobId: job.id }, entityId: job.customerId, entityType: "customer", mode: input.mode, outcome: "failure", summary: "Automatic subscription activation exhausted its recovery window." }, undefined, { kind: "system" });
      await db.execute(sql`update subscription_activation_jobs set status = 'exhausted', last_error_message = ${error.slice(0, 180)}, claim_token = null, updated_at = now() where id = ${job.id} and claim_token = ${job.claimToken}`);
      exhaustedCount += alert.isNew ? 1 : 0;
      continue;
    }
    const delay = getSubscriptionActivationRetryDelay(job.attemptCount);
    await db.execute(sql`update subscription_activation_jobs set status = 'retrying', last_error_message = ${error.slice(0, 180)}, next_attempt_at = now() + (${delay} * interval '1 millisecond'), claim_token = null, updated_at = now() where id = ${job.id} and claim_token = ${job.claimToken}`);
    retriedCount += 1;
  }
  return { activatedCount, attemptedCount: claimed.rows.length, exhaustedCount, retriedCount };
}

export async function completeSubscriptionActivationJob(input: { customerId: string; mode: MollieMode; tenantId: string; subscriptionId: string }) {
  await getDb().execute(sql`
    update subscription_activation_jobs j set status = 'succeeded', subscription_id = ${input.subscriptionId}, claim_token = null, last_error_message = null, updated_at = now()
    from subscriptions s where s.id = ${input.subscriptionId} and s.tenant_id = ${input.tenantId} and s.mode = ${input.mode}
      and j.consent_id::text = s.metadata ->> 'consentId' and j.customer_id = ${input.customerId}
      and j.tenant_id = ${input.tenantId} and j.mode = ${input.mode}
  `);
  // Supersede only activation failures for the now-activated consent's link or
  // its verified payments. Do not hide unrelated provider/processing failures.
  await getDb().execute(sql`
    update webhook_events w set processing_status = 'processed', error_message = null, processed_at = now(), last_attempt_at = now()
    from subscriptions s join subscription_onboarding_consents soc on soc.id::text = s.metadata ->> 'consentId'
      and soc.tenant_id = s.tenant_id and soc.mode = s.mode
    join payment_links pl on pl.id = soc.payment_link_id and pl.tenant_id = soc.tenant_id and pl.mode = soc.mode
    where s.id = ${input.subscriptionId} and s.tenant_id = ${input.tenantId} and s.mode = ${input.mode}
      and w.tenant_id = s.tenant_id and w.mode = s.mode and w.processing_status = 'failed'
      and w.error_message like 'Subscription activation is not ready:%'
      and (w.resource_id = pl.mollie_payment_link_id or pl.metadata -> 'paymentIds' ? w.resource_id)
  `);
}

// Discover payments even if no webhook ever arrived. Oldest-checked ordering
// prevents an unpaid link from permanently starving later accepted consents.
export async function discoverPendingOnboardingPayments(input: { limit: number; mode: MollieMode; tenantId: string }) {
  const rows = await getDb().execute<{ mollieId: string; id: string }>(sql`
    select pl.id, pl.mollie_payment_link_id as "mollieId"
    from subscription_onboarding_consents soc
    join payment_links pl on pl.id = soc.payment_link_id and pl.tenant_id = soc.tenant_id and pl.mode = soc.mode
    join customers c on c.id = soc.customer_id and c.tenant_id = soc.tenant_id
    where soc.tenant_id = ${input.tenantId} and soc.mode = ${input.mode} and soc.accepted_at is not null and c.archived_at is null
      and pl.mollie_status not in ('archived', 'canceled', 'failed')
      and not exists (select 1 from subscriptions s where s.customer_id = soc.customer_id and s.tenant_id = soc.tenant_id and s.mode = soc.mode and s.local_status in ('active', 'mandate_pending', 'draft'))
      and not exists (select 1 from subscriptions s where s.tenant_id = soc.tenant_id and s.mode = soc.mode and s.metadata ->> 'consentId' = soc.id::text)
      and not exists (select 1 from subscription_activation_jobs j where j.consent_id = soc.id and j.tenant_id = soc.tenant_id and j.mode = soc.mode)
    order by coalesce(pl.metadata ->> 'onboardingCheckedAt', '') asc, soc.accepted_at asc limit ${input.limit}
  `);
  let failedCount = 0;
  for (const row of rows.rows) {
    await getDb().execute(sql`update payment_links set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('onboardingCheckedAt', now()) where id = ${row.id} and tenant_id = ${input.tenantId} and mode = ${input.mode}`);
    try {
      await syncPaymentLinkByMollieId(row.mollieId, { tenantId: input.tenantId, preferredMode: input.mode, strictMode: true, reconciliationMode: "sync_only" });
    } catch { failedCount += 1; }
  }
  return { checkedCount: rows.rows.length, failedCount };
}
