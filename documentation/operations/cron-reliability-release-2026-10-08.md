# Cron reliability release — 8 October 2026

## Scope and evidence

Parent: `81ac2fea62be7698335f310b98e5aa597d49df52` (deployed KOR safeguards).
This release changes cron provider routing, failure accounting and operator
summary delivery. No schema migration, tax/account changes, scheduler frequency
change or historical invoice repair is included.

Remote master was rechecked read-only during this slice and remains the parent SHA.

Clean parent validation: 470/471 Node tests pass. The single existing failure is
`customer lifecycle UI surface` / `derives lifecycle state in the customer UI without manual override fields`. Final isolated candidate checks are recorded below.

Read-only recipient check on 8 October: the explicitly scoped Vercel project
`prj_DO7AjYeMLNuQ6BW8WtgWvsGxNdbv`, team `team_Bv4Mnsq4nacXWEj1H5efabqO`, still
has `ALERT_EMAIL_TO=info@ayalweb.com` and production
`INVOICE_EMAIL_OVERRIDE_TO=info@ayalweb.com`. Connector listing returned 403;
the mapped CLI read succeeded. Only these non-secret recipient values were
displayed. No environment variable was changed and no live email was sent.

## Approval A: push and automatic deployment

1. Resolve the exact approved cron commit from the local delivery report. Check
   `git show --stat <approved-sha>` and `git diff 81ac2fe <approved-sha> -- vercel.json db/drizzle`:
   no scheduler or migration changes are expected. Confirm remote master is
   still the parent with `git ls-remote origin refs/heads/master`; if it moved,
   stop and review the new base before pushing. Never push unrelated local work.
2. After explicit approval, run `git push origin <approved-sha>:refs/heads/master`.
   This creates the Vercel production deployment. Do not force-push.
3. Read Vercel deployment metadata until the Git deployment is READY. Confirm its
   Git SHA equals the approved SHA and `kify.app` points to that deployment.
   A successful push alone is not deployment evidence.
4. Recheck the two recipient values read-only; preserve both `info@ayalweb.com`
   settings. Check `MOLLIE_DEFAULT_MODE=live`, cron-secret/SMTP presence and the
   daily `0 3 * * *` UTC schedule without exposing credentials. Inspect recent
   runtime errors and GET the unscoped authenticated `/api/health`. Do not call
   tenant-scoped readiness that may refresh OAuth credentials merely for this check.
5. Confirm Ayal Web remains `kor / GEEN / 0.00`, migration 0029 is applied and
   compare the invoice/delivery backlog to the pre-release snapshot using a
   read-only transaction against the previously verified production database
   (`ep-shy-paper-alzgigh2`, `neondb`). No new billing/configuration mutation is
   authorized by this verification step. The separate KOR live test remains waived.

Do not run `ops:invoice-check`, `ops:invoice-gate`, the autonomy/self-heal commands
or GET/POST `/api/cron/recurring-invoices` for release testing: those paths can
invoke full billing. There is no new read-only/dry-run cron endpoint in this slice.

## Scheduled execution evidence

Wait for the next normal 03:00 UTC run after deployment (if released on 8 October
before that next run: 9 October 2026, 05:00 Europe/Amsterdam). Observe logs/audits;
do not press Vercel's cron Run button. Record the deployed SHA, execution time,
tenant/mode, `runId`, completed/failed stages, batch counts and outcome. Inspect
existing invoice/delivery links for any affected owners without recreating them.

A partial run returns HTTP 200 with `status: partial`. Aggregate counts include
completed stages only; inspect incomplete stages because they may have committed
side effects. A healthy or empty run intentionally sends no summary. Absence of
an email does not prove the scheduler ran. Failure to start, hard termination or
an SMTP outage still requires the separate independent-monitoring work item.

## Approval B: one operator email, without billing

Separately approve **one** synthetic summary addressed only to the configured
`ALERT_EMAIL_TO=info@ayalweb.com`. It will write one `cron.issue_notification`
audit, and will not invoke any cron, invoice, payment, retry or customer-send
function. No recipient configuration changes are required.

Use an isolated checkout of the approved commit with securely supplied production
SMTP/APP_URL/database settings, `AUTH_SECRET` (needed by the audit module import), and `ALERT_EMAIL_TO`; never print those credentials
or commit an environment file. Verify the database/recipient identity before
execution. Run the following once from that checkout after securely loading those
variables into the process (the code explicitly guards the expected mailbox):

```powershell
@'
// This is a standalone server process; keep the normal React runtime.
require.cache[require.resolve("server-only")] = { exports: {} };
const { env } = require("./lib/env.ts");
const { notifyCronIssues } = require("./lib/reliability/cron-issue-notification.ts");
(async () => {
if (env.ALERT_EMAIL_TO !== "info@ayalweb.com") throw new Error("Unexpected operator recipient");
const runId = crypto.randomUUID();
const outcome = await notifyCronIssues({
  mode: "test",
  runId,
  issues: [{ tenantId: null, tenantName: "Operator delivery check (no billing)",
    stage: "Synthetic release check only; no invoices, payments or customer emails were processed", count: 1 }],
});
console.log(JSON.stringify({ runId, outcome }));
process.exit(outcome === "sent" ? 0 : 1);
})().catch(() => { console.error("Operator notification check failed; inspect audit/mailbox before retrying."); process.exit(1); });
'@ | node --import tsx
```

Record `runId`, outcome, matching audit and actual receipt in the operator inbox.
`sent` means SMTP accepted the message and the audit succeeded; inbox receipt
still requires observation. `sent_audit_failed` must not be retried automatically.
For `failed`, SMTP acceptance may still be uncertain: inspect the mailbox/provider
before approving another attempt. Do not run full billing to manufacture an issue.
This proves the deployed code's standalone notifier against production services,
not the scheduled route itself; record scheduled evidence separately.

## Stop and rollback

If deployment fails, retain the previous READY release and inspect build/runtime
logs. If a release regression requires rollback, obtain approval to restore the
known KOR release `dpl_2x3GKwfuCCTuiaDcBezZYGMXKEJC` / `81ac2fe`; do not revert
schema, tax settings, invoices or payments. Never replay full billing as rollback.

## Validation and release ledger

- Isolated candidate: 508/509 Node tests pass; the only failure is the same parent customer lifecycle UI assertion. All 41 focused cron/routing/notification checks pass. Typecheck passes; scoped ESLint has zero errors and the two unchanged first-payment unused-import warnings.
- Default `npm run build` passes with dependencies physically inside the isolated checkout and a dummy build-only AUTH_SECRET; no production environment file was copied. The initial dependency-junction attempt was rejected by Turbopack before compilation; correcting that validation layout resolved it.
- Scoped local commit: this document is included in `Fix cron reliability and isolate operator notifications`; use Git history for the exact SHA. Its tree is checked independently of the mixed checkout.
- Push/deployment: not authorized or performed in this slice.
- Scheduled execution of this version: not yet observed.
- Synthetic operator email: not authorized or sent.
- Actual inbox receipt: unverified.
- Next development task: separately bounded Cloudflare sync-only recovery;
  independent monitoring and Connect ownership remain separate items.
