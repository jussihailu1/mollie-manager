# Production health and follow-ups — 22 October 2026

This is the current operational handoff for the billing/recovery incident. It
supersedes older open scheduled-run checkboxes, not the historical release
evidence. Recheck live state before changes. All dates below use Europe/Amsterdam
unless explicitly UTC.

## Verified read-only findings

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

| Item | Status / next step |
| --- | --- |
| Issue 2: independent monitoring | OPEN. External missed/late heartbeat, runtime and alert-delivery monitoring must work when Kify/SMTP is unavailable. See the main roadmap's monitoring acceptance criteria. |
| Issue 3: operator email proof | OPEN. Separately approve a bounded synthetic operator-only notification, with no billing/replay, then verify SMTP outcome, audit and actual inbox receipt. No test email is authorized by this documentation task. |
| Issue 4: dependency-security release | FIXED AND VALIDATED LOCALLY; NOT RELEASED. Dependency commit `3c263b9` patches Next.js/eslint-config-next to 16.4.2 and ip-address to 10.7.4; UI/test fixes are a separate local commit. Clean install/build/typecheck/SMTP and 8 local auth/access checks pass; 518/518 tests, lint zero errors/warnings, production audit zero findings. Push/deployment remain prohibited. See [fixes and evidence](security-dependency-fixes-2026-10-22.md). |
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
