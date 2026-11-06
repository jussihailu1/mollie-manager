import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { isBearerAuthorized } from "@/lib/cron-auth";
import { listTenants } from "@/lib/tenants";
import { discoverPendingOnboardingPayments, processSubscriptionActivationJobsBatch } from "@/lib/onboarding/subscription-activation-jobs";
import { deliverSubscriptionActivationNotificationsBatch } from "@/lib/onboarding/subscription-activation-notifications";
import { writeAuditLog } from "@/lib/audit";
import { checkInvoiceAutomation } from "@/lib/reliability/invoice-watchdog";

export const maxDuration = 60;

// Separate credential and endpoint: the frequent worker cannot run invoice
// creation or retry arbitrary collections. Production scheduler uses live only.
export async function POST(request: Request) {
  const secrets = [process.env.ONBOARDING_TIMER_SECRET].filter((value): value is string => Boolean(value));
  if (!isBearerAuthorized(request.headers.get("authorization"), secrets)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const runId = crypto.randomUUID();
  const trigger = request.headers.get("x-kify-recovery-trigger") === "schedule" ? "schedule" : "manual_or_external";
  const scheduler = request.headers.get("x-kify-recovery-scheduler") === "cloudflare" ? "cloudflare" : "external";
  const results = [];
  for (const tenant of await listTenants()) {
    let invoiceWatchdogFailed = false;
    try { invoiceWatchdogFailed = (await checkInvoiceAutomation(tenant)).issueCount > 0; }
    catch { invoiceWatchdogFailed = true; console.error("Invoice watchdog failed", { runId, tenantId: tenant.id }); }
    try {
      const context = { tenantId: tenant.id, mode: "live" as const, limit: 2 };
      const discovery = await discoverPendingOnboardingPayments(context);
      const activation = await processSubscriptionActivationJobsBatch(context);
      const notifications = await deliverSubscriptionActivationNotificationsBatch({ ...context, limit: 5 });
      const overdue = await getDb().execute<{ count: number }>(sql`
        select count(*)::int as count from subscription_activation_jobs
        where tenant_id = ${tenant.id} and mode = 'live' and status = 'exhausted'
      `);
      const failed = invoiceWatchdogFailed || discovery.failedCount > 0 || notifications.failedCount > 0 || overdue.rows[0].count > 0;
      const details = { runId, trigger, scheduler, discovery, activation, notifications, invoiceWatchdogFailed };
      await writeAuditLog({ action: "onboarding.recovery", entityId: tenant.id, entityType: "tenant_onboarding_recovery", mode: "live", outcome: failed ? "failure" : "success", summary: "Processed automatic onboarding recovery.", details }, undefined, { kind: "system" });
      results.push({ tenantId: tenant.id, failed, ...details });
    } catch {
      console.error("Onboarding recovery failed", { runId, tenantId: tenant.id });
      results.push({ tenantId: tenant.id, failed: true });
    }
  }
  const failed = results.some((result) => result.failed);
  return Response.json({ runId, status: failed ? "partial" : "ok", results }, { status: failed ? 503 : 200 });
}
