import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { openAlert } from "@/lib/reliability/alerts";
import { sendOperatorEmailOnce } from "@/lib/notifications/email";
import { finishAcceptedInvoiceEmails } from "@/lib/invoice-email-attempt-store";
import { invoiceWatchdogIssues, type InvoiceWatchdogSnapshot } from "@/lib/reliability/invoice-watchdog-policy";
import { writeAuditLog } from "@/lib/audit";

// Invoked by the independent five-minute timer, before onboarding work. It
// observes invoicing and completes acknowledged email persistence; it never
// creates an invoice, starts a collection, or replays an uncertain message.
export async function checkInvoiceAutomation(tenant: { id: string; name: string }) {
  const context = { tenantId: tenant.id, mode: "live" as const };
  await finishAcceptedInvoiceEmails(context);
  const result = await getDb().execute<InvoiceWatchdogSnapshot>(sql`
    with owners as (
      select p.invoice_state::text as state, p.updated_at, p.metadata, p.customer_id, p.mode, p.tenant_id,
        coalesce(p.paid_at, p.created_at)::date as due_date from payments p
        where p.tenant_id = ${tenant.id} and p.mode = 'live' and p.payment_type = 'first'
          and p.invoice_state not in ('not_applicable', 'skipped')
      union all
      select r.invoice_state::text, r.updated_at, r.metadata, s.customer_id, r.mode, r.tenant_id, r.invoice_send_due_date
        from recurring_billing_schedules r join subscriptions s on s.id = r.subscription_id and s.tenant_id = r.tenant_id and s.mode = r.mode
        where r.tenant_id = ${tenant.id} and r.mode = 'live'
    )
    select
      (select count(*)::int from subscriptions where tenant_id = ${tenant.id} and mode = 'live' and local_status = 'active') as "activeCount",
      (select max(created_at)::text from audit_logs where entity_id = ${tenant.id} and entity_type = 'tenant_recurring_billing_cron'
        and action = 'recurring_invoice.cron_batch_create' and mode = 'live' and outcome = 'success') as "lastSuccess",
      count(*) filter (where state in ('pending_invoice','invoice_creating','invoice_created','invoice_failed') and due_date < (now() at time zone 'Europe/Amsterdam')::date)::int as "overdueCount",
      count(*) filter (where state = 'pending_invoice' and due_date <= (now() at time zone 'Europe/Amsterdam')::date
        and exists (select 1 from tenant_billing_settings where tenant_id = ${tenant.id} and active_invoice_provider = 'eboekhouden')
        and not exists (select 1 from customer_accounting_links cal where cal.tenant_id = owners.tenant_id and cal.mode = owners.mode and cal.customer_id = owners.customer_id and cal.provider = 'eboekhouden' and cal.provider_customer_id ~ '^[1-9][0-9]*$'))::int as "blockedCount",
      count(*) filter (where state = 'invoice_creating' and coalesce(metadata ->> 'invoiceCreationClaimedAt', updated_at::text)::timestamptz < now() - interval '15 minutes')::int as "stalledCount",
      count(*) filter (where metadata ->> 'invoiceDeliveryAttemptState' = 'uncertain'
        or (metadata ->> 'invoiceDeliveryAttemptState' = 'sending' and coalesce(metadata ->> 'invoiceDeliveryClaimedAt', updated_at::text)::timestamptz < now() - interval '15 minutes'))::int as "uncertainEmailCount"
    from owners
  `);
  const issues = invoiceWatchdogIssues(result.rows[0]);
  for (const issue of issues) {
    const alert = await openAlert({ tenantId: tenant.id, severity: "warning", title: `Invoice automation: ${issue.key}`, message: issue.message, payload: { kind: "invoice_watchdog", issueKey: issue.key, mode: "live" } });
    if (alert.isNew) {
      try {
        await sendOperatorEmailOnce({ subject: `[Kify] ${tenant.name}: invoice automation needs attention`, text: `${issue.message}\n\nOpen https://kify.app/settings and review the workspace activity. Do not recreate charges or invoices without checking their existing records.` });
        await getDb().execute(sql`update alerts set email_sent_at = now(), updated_at = now() where id = ${alert.id} and payload ->> 'tenantId' = ${tenant.id}`);
      } catch { console.error("Invoice watchdog alert email did not complete", { alertId: alert.id, tenantId: tenant.id }); }
    }
  }
  await getDb().execute(sql`
    update alerts set status = 'resolved', resolved_at = now(), updated_at = now()
    where status in ('open', 'acknowledged') and payload ->> 'tenantId' = ${tenant.id} and payload ->> 'kind' = 'invoice_watchdog'
      and not (${JSON.stringify(issues.map(issue => issue.key))}::jsonb ? (payload ->> 'issueKey'))
  `);
  await writeAuditLog({ action: "invoicing.watchdog", entityId: tenant.id, entityType: "tenant_invoice_watchdog", mode: "live", outcome: issues.length ? "failure" : "success", summary: "Checked independent invoice heartbeat and unresolved billing work.", details: { issues: issues.map(issue => issue.key), ...result.rows[0] } }, undefined, { kind: "system" });
  return { issueCount: issues.length };
}
