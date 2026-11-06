# Production health and follow-ups — 22 October 2026

This is the current operational handoff for the billing/recovery incident. It
supersedes older open scheduled-run checkboxes, not the historical release
evidence. Recheck live state before changes. All dates below use Europe/Amsterdam
unless explicitly UTC.

## Deferred by user — next Kify session starts here

On 22 October 2026, after reviewing the findings below, the user chose to defer
these operational follow-ups. They remain **open, not resolved**. Documentation
is the only current task; the monitoring proposal is not an approved implementation
or service selection. No ongoing monitor, reminder or email test has been set up.

At the next Kify work session, surface this checklist before choosing new work.
Recheck dated evidence read-only; do not assume an expected event happened or
automatically execute the proposed fixes.

| Open item | Last verified state | What to check or decide next |
| --- | --- | --- |
| Genuine Mollie webhook proof | Both subscription URLs repaired; zero recorded receipts since repair; latest receipt 12 September | Look for a naturally received live event, correct tenant, successful processing and authoritative payment sync. Do not replay or create payments to test. |
| Independent monitoring — recommended first implementation | No external monitoring established in the inspected setup | Review the proposal below. Detection and notification must survive Kify/SMTP failure; approve scope and service before setup. |
| Operator email delivery | No recent recorded notification attempt or matching inbox evidence | A separately authorized operator-only test must prove transport, audit and inbox receipt. Preserve the recipient override. |
| Recovery and ordinary invoice proof after release | READY `e1f895c`, ten health checks passed; latest recovery run predates this release | Check actual runs from 23 October onward and ordinary invoices due 27 October / 5 November. Collections were scheduled for 1 / 10 November. These dates are observation checkpoints, not instructions to run billing. |
| Development dependency advisory | Zero production findings; nine development-only entries from one unpatched braces advisory | Recheck upstream when maintenance resumes; keep tooling inputs trusted and avoid forced downgrades. |

Preserve `INVOICE_EMAIL_OVERRIDE_TO=info@ayalweb.com`. No push, deployment,
configuration change, billing, subscription creation, charge, invoice, webhook
replay or email is authorized by this handoff. The product roadmap still has
Kify-owned invoicing K7/K8 as its active milestone; this deferral does not close
its live-proof gates or promote other backlog work.

Git checkpoint at deferral: main HEAD `a9f68ec` is local documentation above
remote/production `e1f895c`; this session's handoff and roadmap edits are also
local and uncommitted. Recheck Git before resuming, preserve existing changes and
other worktrees, and do not push merely to save documentation because that may
trigger deployment. Detailed evidence, limitations and the proposal follow.

## Operational follow-up — 22 October, 23:45–23:48 Europe/Amsterdam

Current scope is read-only investigation plus these documentation updates.
No implementation, configuration change, push, deployment, billing, subscription
creation, charge, invoice, webhook replay or email is authorized in this pass.
The intentional invoice recipient override remains `info@ayalweb.com`.

### Current evidence

- Main checkout started clean at `a9f68ec`; `git ls-remote` independently reports
  GitHub master at `e1f895c861f95b374293c44d6b908a5d8997dbc8`. The one local commit
  is documentation only. The settings/reliability worktree still contains its
  seven modified and two untracked files; it was read but not edited. The old
  detached validation worktree remains registered/prunable; no cleanup performed.
- Vercel domain lookup still resolves `kify.app` to READY deployment
  `dpl_DukhWo1YHo2DZhhyQzwPabi5L6xa`, exact release SHA `e1f895c`. All ten
  GET-only health/access checks passed again. Authenticated health reports live
  mode, database OK and platform readiness passed; request ID
  `fra1::iad1::hzgr9-1792705651682-f9a1e395b204`.
- Fresh CLI/API reads at 23:48 confirm the production cron is enabled on this
  deployment with `0 3 * * *`, both URL environment values are `https://kify.app`,
  and `ALERT_EMAIL_TO` / `INVOICE_EMAIL_OVERRIDE_TO` both equal `info@ayalweb.com`.
  Both cron-secret names remain present; no monitoring-related variable names
  matched the bounded inventory. The connector environment read returned 403,
  but the same scoped read succeeded through the CLI's existing authentication.
  This supersedes the earlier session's CLI-access limitation; no config changed.
- At `2026-10-22T21:45:51.243Z`, a repeatable-read database transaction verified
  `transaction_read_only=on`: **30 webhook records, zero since the repair cutoff
  `2026-10-22T20:09:00Z`, latest `2026-09-12T02:26:02.187Z`**. There is no new
  receipt to correlate with tenant, processing success and payment synchronization.
  Requests rejected before event persistence cannot be excluded by this query.
- Fresh Mollie GETs, using the existing tenant-owned live key without an OAuth
  refresh, verified the Ayal Web profile and both active subscriptions. Both
  still use `https://kify.app/api/webhooks/mollie` without a query. Next payment
  dates remain 1 and 10 November. Complete paginated payment lists still contain
  seven paid payments, all present locally with matching paid status; no newly
  generated subscription payment was found. No evidence yet proves or disproves
  delivery of a naturally generated notification after repair.
- Daily recovery still has 15 successful tenant completion audits on 8–22 October,
  with all 13 stages and no failed stages on 9–22 October. Latest completion is
  22 October 05:23:22.935, run `0d712514-a9d0-47d1-9746-698d86af4477`.
  **That run predates the security release.** The first scheduled run on `e1f895c`
  is not due until 23 October; it has not been verified on this revision yet.
- No overdue live invoice owners, failed/creating owners or created-but-unsent
  owners were found. Two future pending schedules remain: EUR 24.90 invoice
  27 October / collection 1 November, and EUR 19.99 invoice 5 November /
  collection 10 November. No new live invoice or alert was recorded since
  8 October. Tenant settings remain `eboekhouden / kor / GEEN / 0.00 / app_smtp`.
- No `cron.issue_notification` or other notification/email/delivery audit matched
  the 8 October–inspection window. Connected Gmail identifies the operator
  mailbox as `info@ayalweb.com`; two bounded searches including spam/trash found
  no matching Kify/Mollie Manager notification messages. This is search evidence,
  not proof of nondelivery or a transport failure; there was no recorded test
  attempt to verify. No message was sent or changed.
- Axiom organization `ayal-web-ybgm` (Ayal Web) has **zero monitors and zero
  notifiers**. Available datasets are `ere-booking-server-v2` and two demos;
  no identifiable Kify dataset was returned. Source inspection found no external
  heartbeat/error-monitor integration. The dashboard's existing cron heartbeat
  is a database audit read and cannot alert independently when Kify is down.
  These checks do not inventory unconnected third-party monitoring accounts.
- Vercel's deployment-scoped error/fatal query for 21:15–21:45 UTC returned no
  records. The wider since-repair query failed with a Hobby retention error;
  it did not establish an empty historical window. Drain inventory returned 404,
  so absence of a drain is not established by that API call.
- Fresh audits still report zero production findings and nine high development
  entries, all from `GHSA-vfj7-8cjw-p6xm`. The
  [upstream advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) still
  lists no patched version. Deeply nested untrusted patterns can terminate
  tooling through stack exhaustion. Keep tooling inputs trusted; retain the
  separate dependency review and avoid forced dependency replacements.

Sanitized inspection, configuration, audit and repeated health evidence plus read-only scripts:
`C:\Users\Jussi\Kify-Recovery\2026-10-22-operational-followup`.
Earlier evidence files were preserved. Two inspection-harness attempts failed
before completion (connection startup-option handling, then UNION of different
invoice-state enums); the corrected run used read-only transactions and explicit
text casts. These were probe errors, not production health incidents.

### Next-step proposal — not implemented

1. **Prioritize independent monitoring.** Proposed managed service: Cronitor for
   external HTTP checks and scheduled-job monitoring, with the existing Axiom
   account for retained runtime/error events. Cronitor documents
   [start/complete/fail events, grace and duration limits](https://cronitor.io/docs/cron-job-monitoring)
   and [external HTTP checks with body assertions](https://cronitor.io/docs/uptime-monitoring).
   Account availability, plan/cost and notification destination verification are
   setup gates; no account, purchase, monitor or notification was created here.
2. Prepare a local monitoring-only change for review: a minimal read-only
   diagnostics endpoint with its own monitoring credential, database readiness,
   latest successful tenant/live recovery completion, unresolved-work counters
   and notification-delivery failures. Do not give an outside checker the cron
   bearer secret, which can authorize billing execution. Public `/api/health`
   alone is insufficient: it returns `ok` without checking the database, and
   authenticated unscoped health does not evaluate recovery freshness.
3. Initial proposed thresholds: external GET every five minutes, alert after two
   consecutive failures; daily job schedule `0 3 * * *` in **UTC**, 75-minute
   schedule grace, with today's successful completion required by 04:15 UTC.
   [Vercel Hobby can invoke anywhere within the scheduled hour](https://vercel.com/docs/cron-jobs/manage-cron-jobs),
   so alerting at 03:05 would be incorrect. This deadline is 06:15 Amsterdam
   through 24 October and 05:15 from 25 October. Track start and completion with
   one run ID; propose a separate ten-minute run timeout, finalized against the
   actual hosted function limit before activation. Do not conflate schedule
   grace with permitted execution duration.
4. Report success only after all expected tenant/live stages and their audits
   finish successfully; emit failure for partial work or notification failure.
   Missing completion must alarm even if Kify cannot emit failure. Monitoring
   calls need bounded timeouts and must never retry billing or mask its outcome.
   Retain sanitized runtime errors and SMTP/audit failure signals externally;
   verify ingestion-loss detection as well as error alerts. Deduplicate by
   environment/tenant/run/issue and send one recovery notice after verified recovery.
5. Route service-owned alerts to `info@ayalweb.com` independently of Kify SMTP,
   and verify a second non-email channel for mailbox/provider outages. Validate
   missed runs, a started-but-hung run, unhealthy HTTP/database, runtime failure,
   SMTP failure and recovery using an isolated synthetic harness. No live billing
   invocation or cron replay is a test mechanism. External setup and alert tests
   require the user's next authorization.
6. Separately authorize **one operator-only message** through the production
   notification sender with a unique correlation marker, no attachment/customer
   recipient or billing action. Verify transport acceptance, audit and actual
   inbox receipt. Ambiguous acceptance requires inspection, not blind resend.
   Local loopback tests already passed; they do not close this delivery gate.
7. Observe the next ordinary event for webhook proof: inherited Kify URL, matching
   tenant/live resource, `processing_status=processed`, processing timestamp and
   authoritative payment sync. Next scheduled collections are 1/10 November;
   ordinary onboarding may supply earlier evidence. Separately inspect the
   23 October recovery audit and 27 October naturally due invoice/delivery.
   No continuing monitor or reminder was installed by this investigation.

## Earlier read-only findings — before the security release

Scope: 8 October 00:00 Europe/Amsterdam through the inspection on 22 October.
Evidence came from Vercel deployment/project/environment reads, authenticated
unscoped health, PostgreSQL read-only transactions, and direct Mollie GETs.
No deployment, cron invocation, webhook POST/replay, provider mutation, invoice,
email, or application-data change was performed.

- Production remains READY on `1179c824859fe2068c3d78791a12e3e47f2b638e`,
  deployment `dpl_k3MdFPW76Uq2Xp14Jo2eqedr78AS`. Authenticated health returned
  database OK, platform readiness passed and live mode. Health request ID:
  `fra1::iad1::jglcq-1792697994551-894ae6bb783b`.
- Cron is enabled at `0 3 * * *` UTC. There are 15 successful daily tenant
  completion audits from 8–22 October, with no missing dates. All 14 runs after
  deployment (9–22 October) recorded all 13 completed stages and no failed stages.
  Latest completion: 22 October 05:23:22 Europe/Amsterdam; run ID
  `0d712514-a9d0-47d1-9746-698d86af4477`.
- The sole failure audit in this window is an empty webhook-repair batch on
  8 October before deployment. It is the already-fixed false failure, not a new
  incident. Cron recorded no invoice-creation work due during this period;
  successful scheduling does not prove new invoice issuance or email delivery.
- Both active live subscriptions' complete payment lists were compared with
  Kify: seven provider payments total, no missing local payment IDs, no remaining
  pagination. The new EUR 19.99 payment `tr_usqcxYEX2ykTtJnYMyvXJ` was paid on
  13 October at 02:34:14 UTC and first audited paid by Kify at 03:22:49 UTC,
  through daily recovery. It is settled and linked to invoice `F00053`.
- Live invoice backlog: zero overdue, failed, creating, or created-but-unsent
  owners. Upcoming issuance: EUR 24.90 on 27 October (collection 1 November),
  EUR 19.99 on 5 November (collection 10 November). Do not issue early as a test.
- Ayal Web remains `eboekhouden / kor / GEEN / 0.00 / app_smtp`. No new invoices,
  alerts, or `cron.issue_notification` attempts were recorded in the window.
  Issue-only notifier silence is expected on successful runs, not delivery proof.
- Production `APP_URL` and `MOLLIE_WEBHOOK_PUBLIC_BASE_URL` are both
  `https://kify.app/`; direct Vercel environment reads confirmed these values.
  `ALERT_EMAIL_TO` and intentional `INVOICE_EMAIL_OVERRIDE_TO` both remain
  `info@ayalweb.com`. Both cron-secret names remain configured.
- Only Ayal Web remains in the tenants table. Three old pending test first-payment
  invoices, historical test activation warnings, and unscoped test/preview alerts
  remain. They are not live billing failures and were not cleaned up.
- Vercel historical runtime-error and cron-log queries returned no entries.
  This is a log-evidence limitation, not proof of an error-free runtime window.

## Issue 1 — subscription URLs corrected; genuine delivery proof OPEN

At the initial read-only inspection, both active live subscriptions stored the obsolete webhook destination
`https://mollie-manager.vercel.app/api/webhooks/mollie`. The October payment
inherits the same destination. The old URL returns HTTP 404 with Vercel
`DEPLOYMENT_NOT_FOUND`; a read-only GET to the current Kify webhook route returns
405, consistent with a POST-only route. No webhook has been recorded since
12 September. Daily recovery is compensating, not repairing webhook delivery.

Exact inspected ownership:

| Tenant | Mollie customer | Mollie subscription | Amount |
| --- | --- | --- | --- |
| Ayal Web (`ffdbb026-41cf-4295-876c-324d9906f6e0`) | `cst_94syp8dGZZ` | `sub_qHZPweQuEA` | EUR 24.90 |
| Same tenant | `cst_kccDZFa6Hr` | `sub_pCcUKNZWAu` | EUR 19.99 |

- [x] Reconfirm tenant/profile ownership, current provider state, destination and
  current supported Mollie update semantics before mutation.
- [x] Preserve a secure before-state/rollback record. Original URLs contain a
  legacy secret query parameter: never print or commit its value or the full URL.
- [x] Narrowly update the two existing subscriptions' webhook destinations to
  `https://kify.app/api/webhooks/mollie`, preserving identity, amount, currency,
  interval, mandate, dates, metadata and status. Do not recreate subscriptions.
  Inspect webhook authentication expectations before deciding query parameters.
- [x] Verify provider GETs after the change and verify that no billing records,
  charges or emails were created by the operation. An ambiguous response requires
  rereading provider state, not blindly retrying.
- [x] Record whether any other in-scope active resource has the old URL. Do not
  bulk-update historical payments or replay webhooks merely to test the fix.
  Scope expansion requires a separate decision.
- [ ] Observe the next genuine webhook and its successful tenant-scoped handling.
  Updating configuration/receiving GET 405 is not end-to-end delivery proof.

The app's current webhook base URL is already correct. A code deployment is not
presumed necessary for these two provider-resource updates. No reconfiguration
of Mollie organizations, OAuth ownership, or invoice provider is included.

### Repair evidence — 22 October, 22:09 Europe/Amsterdam

- Reverified the sole local tenant as Ayal Web, both unique live customer /
  subscription mappings, local mandates and intervals, and the provider's active
  subscription state. The tenant's connected organization is `org_19456510`
  (provider name `J Hailu Solutions`), with selected profile `pfl_Befk5XwRXj`
  (`Ayal Web`). This organization name is not a second local tenant.
- Used the existing encrypted tenant-owned **live API key** for this bounded
  maintenance operation. `GET /v2/profiles/me` resolved to that exact selected
  profile; all seven subscription payments also matched that profile and their
  customer/subscription IDs. No OAuth refresh, connection write, account change,
  or change to the app's credential resolver was performed.
- Vercel confirmed `kify.app` still serves READY deployment
  `dpl_k3MdFPW76Uq2Xp14Jo2eqedr78AS` / `1179c82`. The environment connector
  returned 403 and the CLI reported account access unavailable; no new environment
  read is claimed. Used the existing `.env.vercel-production` connection material
  to read current database credentials and verify current Mollie state. The
  earlier production environment evidence above remains the source for current
  configured URL values; environment configuration was not changed.
- Current official [Mollie update-subscription reference](https://docs.mollie.com/reference/update-subscription)
  confirms `PATCH /v2/customers/{customerId}/subscriptions/{subscriptionId}`
  accepts `webhookUrl` and an API key. Each request contained **only**
  `{"webhookUrl":"https://kify.app/api/webhooks/mollie"}`. No testmode or billing
  fields were sent. Both returned HTTP 200; neither response was ambiguous.
- The deployed revision's URL builder and webhook processor use a query-free URL,
  resolve managed tenant ownership and re-fetch provider state; no legacy query
  secret is required. The new URLs deliberately contain no query parameters.
- Authoritative GETs verified each saved URL and equality of **every other
  provider response field**, including IDs, amounts/currency, interval, mandate,
  dates, metadata, description and active status. Further independent GETs
  reconfirmed the saved state. EUR 24.90 retains next payment 1 November; EUR 19.99
  retains next payment 10 November. Both retain their original start dates.
- Read-only full-row fingerprints and counts across all **33 public application
  tables** were identical immediately before and after repair and at final
  verification. The complete seven-payment provider lists and three inspected
  live payment-link objects were unchanged. No application billing, invoice,
  charge, email, replay, deployment, or other mutation endpoint was invoked.
- GET-only route checks returned 405 on Kify and 404 `DEPLOYMENT_NOT_FOUND` on
  the legacy hostname. These are reachability checks, not webhook delivery tests.
- **No genuine delivery proof:** webhook count remained 30, latest receipt
  `2026-09-12T02:26:02.187Z`. No webhook POST or replay was sent. At the next
  naturally generated payment/status change, verify the payment's inherited URL,
  the received event's tenant/mode, `processing_status=processed`, and the
  corresponding authoritative payment sync. Observe ordinary collection dates;
  do not manufacture an early invoice, payment, email, or webhook test.

### Secure rollback and additional findings

- Recovery directory (outside Git):
  `C:\Users\Jussi\Kify-Recovery\2026-10-22-webhook-destinations`.
  Raw before-state, PATCH responses and saved/final provider state are encrypted
  with Windows DPAPI CurrentUser; decrypt/encrypt round trips were verified.
  Directory ACL allows only the current Windows user and SYSTEM. Safe JSON
  evidence and the bounded maintenance script are retained there. Full original
  URLs and their legacy secret values are never printed or committed.
- Rollback, if separately needed: use the same Windows identity to decrypt
  `before-state.dpapi` in memory, reverify ownership and current state, then PATCH
  only each original `webhookUrl` on the same customer/subscription endpoint.
  Re-read provider state after each PATCH. Do not restore whole subscription
  objects or blindly retry. No rollback was performed; the original destination
  is known broken. Environment material is also retained only as DPAPI ciphertext.
- Fully paginated profile subscription inventory found exactly these two active
  subscriptions; neither retains the old hostname after repair. All seven paid
  historical subscription payments retain their old URLs and were left untouched.
- Separately inspected three locally managed live payment links. All are
  unarchived with no expiry: `pl_gjpWpseknZMYxFfhfUcBK` retains the dead Vercel
  hostname; `pl_cn5ShB2pA3zDDmbW78H3s` and `pl_kmyVff6ycdYKZFToPMiEx` retain
  an old ngrok hostname. No query values were disclosed. The later review below
  confirms all three are already-paid, single-use historical links; unarchived
  with no expiry did not establish availability for another payment. This does
  not claim an account-wide historical payment inventory.
- Issue 1's authorized mutation is complete. Genuine webhook receipt/processing
  remains an observation gate. Stop here; issue 4 requires the user's next request.

### Payment-link follow-up — 22 October, 22:23 Europe/Amsterdam

The user asked whether the three legacy payment-link destinations should also be
fixed. Read-only provider GETs and fully paginated payment lists reverified the
same Ayal Web tenant and profile ownership, and established:

| Payment link | Reusable | Provider/local state | Paid at (UTC) |
| --- | --- | --- | --- |
| `pl_cn5ShB2pA3zDDmbW78H3s` | false | paid / paid | 10 April 2026 13:30:14 |
| `pl_gjpWpseknZMYxFfhfUcBK` | false | paid / paid | 10 April 2026 14:45:18 |
| `pl_kmyVff6ycdYKZFToPMiEx` | false | paid / paid | 27 April 2026 15:30:15 |

Each has exactly one paid first payment and no additional payment-list pages.
Mollie's [creation reference](https://docs.mollie.com/reference/create-payment-link)
defines `reusable=false` as a single-payment link. These are consumed historical
onboarding links, not reusable unpaid checkout links. The earlier warning that
these specific links might still accept another payment was too broad.

The current [update reference](https://docs.mollie.com/reference/update-payment-link)
does not list `webhookUrl` as an update field; the installed SDK's update type
also omits it. No undocumented PATCH was attempted. Decision: retain these paid
historical objects unchanged, rather than recreate, archive, or modify them to
address a new-checkout risk that the usage-state check did not substantiate.
Their historical callback URLs remain stale; this review does not establish
delivery of any later status changes on historical payments. Historical payment
mutation/replay remains excluded. New app-created onboarding links already use
Kify's configured URL, independently of these old links.

All 33 application-table counts/fingerprints were identical across the review;
zero provider mutations or checkout visits were made. Evidence is retained in
the existing recovery directory as `payment-link-review.json` (sanitized) and
`payment-link-review-state.dpapi` (encrypted full state). Close the additional
payment-link repair item as **reviewed; no new-payment repair needed**. Genuine
delivery proof for the corrected subscriptions remains open. No issue 4 work.

## Remaining work and decisions

Release update: authorized push deployed `e1f895c` to Kify; Vercel reports READY
on the exact SHA. Ten read-only production checks pass, including database and
platform health. Earlier no-deploy statements and unreleased statuses below are
historical. See the [release evidence](security-release-2026-10-22.md).

| Item | Status / next step |
| --- | --- |
| Issue 2: independent monitoring | OPEN. External missed/late heartbeat, runtime and alert-delivery monitoring must work when Kify/SMTP is unavailable. See the main roadmap's monitoring acceptance criteria. |
| Issue 3: operator email proof | OPEN. Separately approve a bounded synthetic operator-only notification, with no billing/replay, then verify SMTP outcome, audit and actual inbox receipt. No test email is authorized by this documentation task. |
| Issue 4: dependency-security release | RELEASED as `e1f895c`, Vercel READY and production domain/SHA verified. Final local suite 528/528; lint/typecheck/build pass; production audit zero. Ten production GET checks pass, including authenticated database/platform health. See [release evidence](security-release-2026-10-22.md). |
| Additional live payment-link destinations | REVIEW COMPLETE. All three are already-paid, single-use historical onboarding links. No new-payment repair needed; retained unchanged. Webhook URL updates are not documented for payment links. Evidence and historical-status limitation above. |
| Validation debt | UI/test/lint debt resolved locally. Follow-up scoped esbuild override clears four moderate entries; full audit now retains nine development-only high entries, all from unpatched braces. 523/523 tests pass. No forced downgrades or rule suppression. See [development tooling review](dev-dependency-review-2026-10-22.md). Local checks do not prove real OAuth, external delivery or production behavior. |
| Migration snapshot history | REPAIRED LOCALLY. Linked 0027–0029 snapshots and the existing tax-treatment check declaration now match current schema. Existing SQL/journal/snapshots unchanged; two generations produce no SQL. Offline guard rejects deliberate drift; full suite 528/528, lint/typecheck/build pass. No migration applied or deployment. See [repair evidence](migration-snapshot-repair-2026-10-22.md). |
| Actual invoice issuance/delivery | Next naturally due live invoice is 27 October. KOR live test was waived, not passed; no invoice created since the KOR release yet. Observe ordinary issuance/API totals and intended operator delivery without manufacturing early invoices. |
| Faster Cloudflare recovery | OPTIONAL, not implemented. Fix webhooks first, then decide whether daily fallback latency is acceptable. If needed, initial cadence is every two hours, sync-only; never increase full billing frequency. |
| Legacy cron secret | LOW priority. Remove `INVOICE_CRON_SHARED_SECRET` only after checking external callers and preserving valid `CRON_SECRET` authentication. Successful cron runs alone do not prove the older secret is unused. Separate approved configuration/code cleanup. |
| Old test records/alerts | LOW priority review only. Three pending test first-payment invoices and historical test alerts are not live incidents. No deletion, test billing, or automatic resolution approved. |
| Kify-native invoicing | K7 controlled live proof and K8 final documentation remain open, separate from the waived e-Boekhouden KOR test. |
| Mollie Connect | Ownership design and M6 capability/live proof remain deferred; revalidate any old provider blocker before resuming. No account reconfiguration now. |
| Mollie SDK maintenance | Existing roadmap checkpoint: verify legacy SDK/migration requirements by 17 November 2026 against current official guidance. Do not assume an upgrade is already done. |
| Old Git worktrees | Unfinished settings/reliability worktree and detached validation worktree remain separate. No wholesale merge, reset, deletion or cleanup authorized. |

Other product backlog remains in `../product/implementation-roadmap.md`; this
handoff does not promote every deferred feature into an immediate fix.

## Decision log and handoff boundaries

- 22 October, snapshot follow-up: user requested repair of the reported drift.
  Restored only the missing 0027–0029 metadata and existing tax-check schema
  declaration. Preserved all prior migration bytes/IDs and verified no-op
  generation twice plus a deliberately failing drift probe. Added the offline
  snapshot guard to the full suite. Save as a separate local repair commit;
  no migration application, DB access, provider action, push or deployment.

- 22 October, development-tooling follow-up: user requested safe remediation of
  remaining findings without forced downgrades or push/deployment. Retained a
  scoped core-utils/esbuild forward override after actual installed-version,
  transform/loader and baseline-versus-patched migration checks. Four moderate
  findings removed; nine braces-derived high entries remain. Recorded separate
  existing snapshot debt; no schema/DB changes. Detailed validation and override
  maintenance/removal conditions are in the linked development tooling review.

- 22 October, implementation follow-up: user authorized fixing issue 4 findings,
  rerunning validation and separate local dependency/UI commits. Completed
  dependency-only `3c263b9` and the separate UI/test/evidence changes. Fresh
  isolated validation is recorded in the linked fixes document. Preserve the
  invoice recipient override, other worktrees and all production state. No push,
  deployment, real billing/repair, invoices, webhook replay, email or account
  changes. This supersedes earlier review-only/no-implementation boundaries.

- 22 October, 22:29–22:33: user authorized issue 4 review and validation refresh,
  explicitly prohibiting push/deployment. Reviewed the existing implementation;
  ran clean isolated install, audits, full tests/lint, typecheck, build, loopback
  SMTP and local HTTP auth/access probes without production credentials. Current
  candidate has new Next.js advisories plus unchanged lint/test debt. Recorded
  exact remaining fixes in the linked review; application source and dependency
  versions remain unchanged. No billing, provider/database mutation, real email,
  account change or production test. Save a separate local documentation checkpoint.

- 22 October, 22:23: user asked to address the legacy payment links. Current
  provider usage-state inspection showed all three already paid and non-reusable.
  Corrected the prior overly broad risk statement and closed the new-payment
  repair follow-up without production changes. Retain historical records; no
  undocumented webhook-field update, recreation, archival or replay. Record this
  clarification in a separate local documentation checkpoint; no push/deployment.

- 22 October, follow-up: user explicitly authorized a local documentation commit
  between issue 1 and any later work. This supersedes the earlier no-commit
  instruction for these handoff/roadmap notes only. No push or deployment is
  authorized; issue 4 still awaits a separate request. Existing health-check
  documentation, including its security-release status note, belongs in this
  documentation checkpoint; no dependency implementation is changed.
- New-subscription clarification: deployed `1179c82` supplies the configured
  webhook URL when creating both onboarding payment links and subscriptions.
  The recorded production base is Kify, so normal new live onboarding should use
  the correct URL without a deployment. The three flagged links are existing
  provider objects and are not evidence that newly created links use old URLs.
  Their stale callbacks can prevent prompt payment/activation updates if reused;
  their checkout usability was not tested. Removed subscription query parameters
  were legacy shared-secret material, not billing/customer metadata. The deployed
  handler does not require them. Successful genuine delivery remains unproven;
  the user's next ordinary onboarding can provide natural observation evidence,
  without authorizing the agent to create a subscription or send messages.

- 22 October, 22:09: completed the explicitly authorized two-subscription URL-only
  repair with secure rollback and unchanged-field verification. No commit, push,
  deployment, billing, replay, email, account change or issue 4 work. Preserved
  pre-existing documentation edits and other worktrees. Provider URL correction
  is complete; genuine delivery proof and the separate payment-link review remain.

- 8 October: JHS cleanup was reported complete by the user: 380 JHS-only records
  deleted after an encrypted recovery backup at
  `C:\Users\Jussi\Kify-Recovery\2026-10-08-jhs-cleanup`, with retained records
  across 33 tables verified unchanged in that side chat. The 22 October tenant
  query independently confirms only Ayal Web remains; it does not reverify all
  backup/deletion claims. Tenant retirement is removed from the plan. No repeat
  cleanup or retirement feature.
- Preserve the accepted invoice-recipient override to `info@ayalweb.com`.
  Operator delivery is not customer receipt; do not remove the override or resend.
- Preserve API-based invoice verification and normal attachment checks. Visual
  PDF review remains for setup/template/tax changes or incidents. Do not restore
  the rejected routine PDF parser/hash gate or reopen resolved historical tax
  corrections merely to complete an old checklist.
- 22 October: read-only production inspection authorized; deployment explicitly
  prohibited. The check is complete. Nothing financial or operational was replayed.
- 22 October: user requested durable notes of outstanding work and relevant
  decisions, plus a prompt for issue 1 in a new chat. Issue 4 will be discussed
  later in that same new chat when the user asks; it is not bundled into issue 1.
  Keep future decisions, approvals, evidence and unresolved proof gates updated
  here and in the linked release documents.
- Current main checkout before this documentation edit was clean at `4cb19ed`,
  three commits ahead of GitHub `master`/production `1179c82`: `40b38c8`,
  `47fa61f`, `4cb19ed`. A push would include the pending security update and may
  deploy production. Do not push just to save these notes or the webhook handoff.
  Recheck Git/worktree state; preserve unrelated work and use scoped commits only
  when requested. A later follow-up authorized the documentation-only local commit
  recorded above; push and deployment remain prohibited.

References: [temporary recovery roadmap](TEMP-billing-recovery-roadmap.md),
[cron release ledger](cron-reliability-release-2026-10-08.md),
[security release evidence](security-dependency-update-2026-10-08.md),
[main implementation roadmap](../product/implementation-roadmap.md).
