# Temporary billing recovery roadmap

Updated: 2026-10-22. Working checklist for completing the concurrent Kify investigations sequentially. Remove or archive after completion; keep permanent behavior in the invoice runbooks.

## Scope and working rules

Work from this chat, one topic at a time. Preserve existing changes and use separate, dependency-complete commits. Some files contain both KOR and cron changes: stage individual hunks rather than whole overlapping files. Do not commit the entire working tree. Commit, deployment, database changes, provider invoice changes, and customer delivery are separate milestones.

Current recorded release state: KOR commit `81ac2fe` and cron reliability commit `1179c82` have been deployed and verified as described below. Historical corrections are resolved; the controlled live KOR test was waived. The 22 October read-only check verified daily cron completion through 22 October; operator notification delivery remains unproven. Both live Mollie subscription webhook URLs were corrected on 22 October with all other fields preserved and provider GET verification; genuine webhook delivery/processing remains unproven. Three historical live payment links retain legacy destinations; follow-up review confirmed they are already paid and single-use, so no new-payment repair is needed. Security commit `4cb19ed` remains local, not deployed. The authorized issue 4 fixes are locally validated: dependency-only `3c263b9` patches Next.js/eslint-config-next and ip-address; separate UI/test changes restore clean validation. Production audit is zero; 13 development-only audit entries remain. Push/deployment remain prohibited. See [22 October fixes and validation](security-dependency-fixes-2026-10-22.md). Use [the 22 October health findings, open-work checklist and decision log](production-health-and-followups-2026-10-22.md) as the current handoff; older snapshots below are historical. Faster recovery remains optional.

At initial handoff, all three source chats were idle. The checkout was on `master` at `665599f`, with 63 modified/untracked files before this document. The commit-boundary notes and continuation log below preserve that earlier state; they are not current instructions to repeat release work.

Sources:

- [Fix KOR invoice tax mismatch](thread://01a117a5-914b-7f41-b991-c7299ada4cc4?hostId=local)
- [Choose Kify reconciliation option](thread://01a00f84-208f-7310-a41e-e3c75f563c9a?hostId=local)
- [Investigate Kify notification alerts](thread://01a01440-facd-7f82-84a8-4686bed47f1e?hostId=local)

## 1. Finish and validate the KOR fix — COMPLETE; RELEASE RECORDED IN STEP 2

### Decision update: PDF checks (2026-10-08)

The user requested a review before continuing; no side-chat changes were made. **Decision: remove automatic PDF text parsing and identical-file-hash requirements from routine e-Boekhouden issuance/delivery.** This replaces the earlier PDF-gate approach; the checklist below reflects the current implementation. The original incident was caused by Kify sending EUR 19.99 excluding VAT with the 21% code; it was not a demonstrated provider calculation or PDF-rendering defect.

Keep the corrected inclusive-price/tax-code request, per-invoice fresh API checks for amount/VAT/identity, frozen tax/amount evidence, manual-review holds, deterministic-reference lookup and duplicate-prevention safeguards. Recheck API identity/amount/VAT before delivery against the frozen issuance evidence, then download the document URL returned for that verified invoice. Keep trusted-URL, file-size/type/signature and download checks; missing/invalid attachments cause delivery retries, not recreation of the invoice.

Check the actual PDF visually during initial setup, after changing the provider template (including edits inside e-Boekhouden) or tax treatment, and during a specific document incident. Review the number, issuer/customer, final total, VAT and KOR notice, and record the template/treatment/sample/reviewer/date in release or operator evidence. This is an operational setup/change checkpoint, not a new per-invoice parser or a claim that Kify detects external template edits.

Concrete residual risk: a template may omit the KOR notice or display stale/incorrect text despite correct API data. No such divergence has been observed. A per-invoice parser could detect some supported text/layout problems, but not reliably validate arbitrary templates; exact byte hashes can also reject a semantically unchanged regenerated PDF. These risks do not justify the stricter delivery gate on current evidence. If a reproducible provider/PDF divergence occurs, investigate it and consider a targeted check. Historic incorrect invoices still require their separate correction process.

- [x] Removed parser/hash gate and `pdfjs-dist` dependency; kept API verification and ordinary attachment checks.
- [x] Tested API failures, identity drift, delivery failure without resetting invoice creation, and successful delivery without any PDF parsing/hash stamp.
- [x] Refreshed tests/typecheck/scoped lint and updated the permanent runbook and commit boundaries. Production build result is recorded below.

Problem: the earlier investigation found that F00048, F00049, F00051 and F00053 showed EUR 24.19 including EUR 4.20 VAT against EUR 19.99 subscription payments. The user confirmed KOR participation predates 2026. Recheck live state before operational changes; payment settlement and invoice status may have changed.

Prepared locally: explicit tenant tax treatment (`kor` / `standard`), VAT-inclusive subscription totals, KOR notice, tax snapshot on issuance attempts, provider identity/total/VAT verification, blocked delivery/manual review after uncertain creation or verification failure, verified recovery and an explicit credited-replacement recovery command. Standard currently covers 21% VAT on the supported EUR subscription flow; effective-dated tax changes remain outside this incident fix.

- [x] Review settings, both first-payment and recurring creation paths, and invoice delivery.
- [x] Verify EUR 19.99 KOR totals, zero VAT and the notice locally through payload, canonical invoice and PDF regression tests. Newly issued provider proof remains step 2.
- [x] Replaced semantic PDF parsing with API checks at issuance and delivery; documented visual PDF review during setup and template/tax changes. Previous F00053 PDF inspection confirmed the API and PDF agreed on EUR 24.19 / EUR 4.20, so the known fault is the request, not provider rendering.
- [x] Exercise uncertain creation, failed API verification, existing-invoice recovery and repeat calls through both real workflow functions with mocked provider/DB boundaries. Review SQL claim/retry guards and add regression coverage. These tests do not simulate a real database race or prove live delivery.
- [x] Run focused regression tests, typecheck, lint, production build and full suite; report pre-existing failures separately (results below).
- [x] Inspect production deployment and the checkout database migration/settings/backlog read-only (findings below).
- [x] Confirm production database identity and recheck its migration/settings/backlog. At 13:25 Europe/Amsterdam, three authenticated production health requests produced corresponding health-query timestamp advances on Neon endpoint `ep-shy-paper-alzgigh2`, database `neondb`; migration/settings/backlog refreshed read-only. See the release preparation evidence. Recheck for drift immediately before an authorized release.
- [x] Record changed-file ownership and a commit boundary, including shared cron result fields required by KOR verification (below).

Known verification limitation: no newly issued live KOR invoice/PDF has been verified; the user waived that test. Migration `0029_tenant_tax_treatment` matched the latest applied migration, and runtime correlation established that production uses the inspected database. No migration was needed. The user subsequently deployed the KOR code and configured Ayal Web deliberately; see step 2 for the release evidence. Unconfigured tenants remain blocked from issuance.

### Verified state on 2026-10-08

- Vercel reports `kify.app` READY on production deployment `dpl_GToDu22bwhDKchyiun8RPUaFC8nd`, commit `665599f154475b2d10db66edc5cdca1e5e308b5e`. None of the local KOR safeguards are deployed.
- Checkout database: Ayal Web uses e-Boekhouden, `tax_treatment` is NULL, VAT code `HOOG_VERK_21`, VAT percentage `21.00`. The column exists and migration 0029's hash matches.
- Checkout database: one pending live recurring invoice, invoice due **27 October 2026**, collection **1 November 2026**. No live paid first-payment invoice in pending/failed/creating states; three test first-payment invoices remain pending. These are a snapshot, not a guarantee that no new work can arrive.
- Provider GETs reconfirm all four originals: F00048 (70863115), F00049 (70863117), F00051 (71366590), F00053 (72234926), each EUR 24.19 total / EUR 4.20 VAT. No credit, replacement or customer message was issued.
- The current [e-Boekhouden OpenAPI](https://api.e-boekhouden.nl/openapi/v1.json) confirms `inExVat: IN` makes the amount VAT-inclusive; omission defaults to EX. Current implementation explicitly supplies IN.

### Current implementation and validation

- Kify supplies a positive two-decimal inclusive price and tax code. Fresh API verification checks the requested relation/reference, invoice ID/number, total and VAT. Invalid/coerced/fractional-cent API amounts fail verification.
- Verification stores `apiVerification` with the expected amount and applied tax treatment. Delivery rechecks those frozen values and identity through the tenant's API credentials, then downloads the fresh invoice URL. It does not use today's tenant tax setting, an old URL, a semantic PDF parser or a PDF hash stamp.
- Trusted PDF URL/redirect, file-size/type/signature checks remain. A missing/invalid attachment causes a delivery failure/retry while preserving the created invoice. Older records without issuance verification evidence require review; no automatic backfill or historical correction is implied.
- Both creation claims and generic provider retry updates honor manual-review holds. The standalone requeue script honors the hold on SELECT and UPDATE and checks canonical stored invoices instead of removed legacy columns.
- Removed the uncommitted PDF parser/tests and `pdfjs-dist`; package files are back to their baseline dependency state. Kify-owned PDF artifact hashes remain unchanged because they serve a separate storage-integrity purpose.
- Added API/delivery regression tests and retained workflow, tax, amount and retry regressions. The focused API/workflow/attachment/scope selection passed **26/26**. Full Node suite: **499/500 passing**; the sole failure remains the pre-existing `customer lifecycle UI surface` assertion. Eight parser tests were removed and six API/delivery tests added.
- Typecheck and lint on changed source files passed (four existing unused-import warnings). Whole-repository lint's earlier unrelated ignored handoff-artifact error remains outside this scope. Do not report global lint as green.
- Production build passed for the API-only revision (`tmp/kor-api-build.log`). Diff whitespace check passed. Local logs: ignored `tmp/kor-api-*.log`.
- No live KOR PDF has been issued or visually approved. Existing provider/PDF observations above are from the preceding read-only review, not a new live check after this decision. No production code, database/configuration, invoice or email changes were made.

### Isolated commit validation (2026-10-08)

Exported the Git index to a temporary directory and installed the baseline lockfile with `npm ci --ignore-scripts --no-audit --no-fund`. This copy excludes all independent cron changes, local environment files and ignored handoff artifacts.

- Full Node suite: **470/471 passing**. The only failure is the same pre-existing `customer lifecycle UI surface` assertion for `lifecycle.summary`; both the test and inspected component are unchanged from the parent commit. The mixed checkout's larger test count above includes uncommitted cron tests.
- Typecheck passed. Whole-repository lint in this clean export passed with zero errors and ten existing warnings; the mixed checkout's ignored artifact lint failure is absent here.
- Production build passed with a placeholder `AUTH_SECRET` supplied only to the validation process. Initial build without environment values failed at the expected missing-secret check. No live credentials or database were needed; this proves buildability, not production behavior.
- Staged whitespace check passed. Working-file hashes confirmed unrelated cron changes were preserved. Validation logs are in `C:\Users\Jussi\AppData\Local\Temp\kify-kor-commit-1wrc8806` (`test.log`, `typecheck.log`, `lint.log`, `build.log`); this temporary location is not durable project documentation.

### Commit boundaries for step 2

Do not stage entire overlapping files. Review the final staged patch and validate the isolated KOR change, not just the mixed checkout.

| Scope | Include in KOR commit | Leave for cron commit |
| --- | --- | --- |
| Settings/schema | Billing settings form/page, `lib/billing-actions.ts`, `lib/billing-settings.ts`, `db/schema.ts`, migration 0029 and journal entry | None |
| Tax/rendering | `lib/invoicing/tax-treatment*`, canonical invoice, renderer, Kify workflow/readiness, provider adapters and their changed tests | None |
| e-Boekhouden issuance/recovery | Changed and new `lib/eboekhouden/*` verification, metadata, claims, persistence, retry/recovery, match helpers and tests; manual failed-invoice recovery helper | In `first-payment-invoices.ts`, exclude the independent `createDueFirstPaymentInvoicesBatch` Kify/legacy-adapter routing hunk |
| Shared cron route | In `app/api/cron/recurring-invoices/route.ts`, include only `verificationFailedCount` recovery-result defaults and aggregation | Issue collection/notifier imports, run ID, failure accounting, `failedCount` fields, response-status and finally/notification changes |
| Delivery | `lib/invoice-delivery.ts` API verification and attachment checks; no package changes are needed | None |
| Operations | `scripts/recover-credited-eboekhouden-invoice.ts`, KOR safeguards in `scripts/invoice-automation-requeue-safe-failed.mjs`, recovery runbook, KOR feature inventory entry, this temporary roadmap | Cron runbook additions, independent-monitoring roadmap additions |
| Independent cron code | None | `lib/reliability/isolated-recovery*`, `repair.ts`, `cron-issue-*`, `lib/cron-batch-regressions.test.ts` |

The manual replacement helper belongs to the failed-attempt recovery safeguard. It is still **not** the historical correction implementation for step 3. At isolation time, the KOR commit included 54 files, using partial staging for the shared cron route, first-payment module and feature inventory. Eight modified tracked files and four new cron files were left for the subsequent cron commit. Both releases are now recorded below.

## 2. Commit, release and verify KOR — RELEASED AND CONFIGURATION VERIFIED; LIVE TEST WAIVED

Release evidence: [8 October preparation and verification](kor-release-preparation-2026-10-08.md). The user pushed `81ac2fea62be7698335f310b98e5aa597d49df52` and configured Ayal Web as KOR. At 14:08 Europe/Amsterdam, remote master and `kify.app` were independently confirmed on that commit, READY Git deployment `dpl_2x3GKwfuCCTuiaDcBezZYGMXKEJC`. Saved settings are `kor`, `GEEN`, `0.00`, provider `eboekhouden`, template `1543946`, ledger `34216546`, delivery `app_smtp`; successful settings audit at 14:04:52. Unscoped authenticated health returned HTTP 200/OK; no error/fatal logs were returned in the inspected 15-minute window. Migration 0029 and backlog were rechecked read-only: unchanged, no live failed/creating invoices, no created-unsent invoices, one EUR 24.90 recurring invoice due 27 October and three pending test first payments. No new invoice or email was triggered. The live issuance/delivery test remains waived, so this is deployment/configuration proof only.

Read-only refresh at 12:44–12:46 Europe/Amsterdam: checkout migration 0029 hash/column/constraint confirmed; Ayal Web treatment remains NULL; no live failed/creating or created-unsent invoices; three paid test first-payment rows pending. The one live recurring candidate is **Kruispunt Welzijn, EUR 24.90**, invoice due **27 October**, collection **1 November**. Provider template/relation/ledger checked; reference has no match. Do not issue early just to test.

Production `DATABASE_URL` remains write-only, but the identity gate is now resolved without exposing it. At 13:25 Europe/Amsterdam, a separate read-only direct Neon connection observed the production health endpoint's `select 1 as ok` query advance for each of three authenticated requests. This establishes that `kify.app` uses endpoint `ep-shy-paper-alzgigh2`, database `neondb`, matching the checkout connection and the user's Neon production screenshot. Refreshed migration/tax/backlog results are unchanged. Tenant-scoped diagnostics were avoided because they can refresh Mollie OAuth credentials. No further operator recollection is required.

Production invoice override is **info@ayalweb.com**. A normal invoice marks the owner sent after operator delivery, so it does not prove customer receipt or automatically queue later customer delivery. The preparation document specifies visual review, then an explicitly approved one-owner delivery with only that process's override removed. No global recipient change is included.

- [x] Prepare one coherent KOR commit including verification and retry safeguards, without independent cron routing/notification changes.
- [x] Review migration and configuration order and prepare the controlled sample procedure. Identity and deliberate KOR configuration are verified; controlled live testing was waived.
- [x] User deployed the reviewed commit and selected KOR; deployed SHA/settings independently verified read-only on 8 October at 14:08 Europe/Amsterdam.
- [~] Controlled live KOR invoice/PDF/delivery test **waived by the user on 2026-10-08**. The user trusts the validated code and requested moving to historical correction preparation. No live proof was obtained; do not issue a test invoice or wait until 27 October as a prerequisite. This does not authorize deployment, tax-setting changes, historical corrections or customer email. Actual historical correction documents still require their own verification.

## 3. Correct the four historical invoices — RESOLVED BY MANUAL CORRECTION

The user corrected VAT on the existing e-Boekhouden invoices. Subsequent read-only API/PDF checks confirmed all four totals are EUR 19.99 with zero VAT and API code `GEEN`, retaining the same provider IDs, numbers, relations and references linked in Kify. Kify scheduled amounts match; F00048/F00049/F00051 have linked paid EUR 19.99 payments, while F00053's collection is planned for 10 October and had no linked payment yet. No stale EUR 24.19 total was stored in the inspected Kify invoice amount fields/snapshot summaries. No Kify amount/link repair or credit/replacement tooling is needed for this incident on these findings.

- [x] Re-read corrected provider invoices/PDFs, Kify owner/invoice/payment links and stored delivery evidence. Provider outstanding-invoice queries returned no matching entries; this alone is not a payment-allocation audit of provider ledger mutations.
- [x] User reports updating the template footer to `Factuur vrijgesteld van OB o.g.v. artikel 25 Wet OB.` and sending the corrected invoices to the company. This final template revision and external delivery are operator-reported, not independently reverified. Earlier inspected PDFs had the corrected totals but lacked the notice.
- [~] Credit/replacement correction procedure, historical Kify data-model changes and apply tooling are no longer needed for these four invoices; do not implement them merely to complete the earlier checklist.

Kify's historical delivery records correctly retain the original operator override to `info@ayalweb.com`; the user's later external sends do not warrant rewriting those audit records. Existing legacy invoices have no new issuance-verification stamp; do not fabricate a backfill or attempt automatic resending under the new verification flow. Retain the ordinary manual-review boundary for any future resend request.

Important: `scripts/recover-credited-eboekhouden-invoice.ts` only accepts owners in `invoice_failed` with a matching unverified upstream invoice identity. It does not implement historical correction of successfully recorded/sent invoices. Do not force those invoices into a failed state to reuse the command. The command records a credit note number but cannot independently prove that credit was issued.

## 4. Finish cron reliability fixes — DEPLOYED; SCHEDULED EXECUTION VERIFIED; EMAIL PROOF OPEN

This slice preserves the deployed KOR safeguards from `81ac2fe`. It routes Kify first payments through the Kify issuer, records empty recovery batches as successful no-ops, counts mixed failures, and sends a consolidated summary through `ALERT_EMAIL_TO`. Tenant results retain completed stages after a later failure and wait for in-flight siblings; failed/unfinished stage counts are not proof of no side effects. Notification/audit failures do not reset invoice or delivery state or request billing replay.

- [x] Review and test active Kify routing, legacy validation, empty batches, mixed results and notification failures using inert provider/DB/SMTP boundaries.
- [x] Preserve tenant/mode scoping, claims, manual-review holds and KOR issuance/delivery safeguards. No tax, invoice or recipient configuration changes.
- [x] Recheck production recipient settings read-only: `ALERT_EMAIL_TO` and `INVOICE_EMAIL_OVERRIDE_TO` both remain `info@ayalweb.com` on 8 October 2026. No email sent.
- [x] Establish the clean parent baseline: `81ac2fe` has 470/471 tests passing; the sole failure is the customer lifecycle UI assertion.
- [x] Isolate and validate the scoped commit `Fix cron reliability and isolate operator notifications`: 508/509 tests pass (same sole baseline failure), typecheck and production build pass, scoped lint has no errors. Full evidence and release gates are in [the cron release procedure](cron-reliability-release-2026-10-08.md); use Git history for the commit SHA.
- [x] User approved pushing `1179c824859fe2068c3d78791a12e3e47f2b638e`; pushed to master and verified READY production deployment `dpl_k3MdFPW76Uq2Xp14Jo2eqedr78AS` at `kify.app` on 8 October at 14:54 Europe/Amsterdam. Authenticated unscoped health passed; recipient/mode/schedule configuration, KOR settings, migration and backlog remain unchanged. No error/fatal logs returned for the new deployment in the inspected window. See the cron release procedure for evidence.
- [x] Read-only inspection on 22 October verified successful daily completion on 8–22 October and all 13 stages on each of the 14 post-deployment runs. No cron was invoked for testing. See the current health handoff for evidence and the separate webhook failure.
- [ ] Separately approve one synthetic operator summary with no billing calls; distinguish SMTP acceptance/audit from confirmed inbox receipt.
- [ ] Keep independent missed-run monitoring and Mollie Connect platform/AYAL/tenant ownership as separate roadmap items.

JHS retirement is removed from scope. Latest user update reports JHS cleanup complete: 380 JHS-only production records deleted after an encrypted backup, retained records across 33 tables unchanged, only Ayal Web visible. Backup location: `C:\Users\Jussi\Kify-Recovery\2026-10-08-jhs-cleanup`. This continuation has not reverified that operation. Fix the provider bug independently of JHS removal. Controlled live Kify-provider invoice proof (K7) and final documentation (K8) remain later milestones.

## 5. Faster Cloudflare recovery — OPTIONAL, reassess after current-flow verification

Timestamp-only stale alerts were already removed in `a56566d`. Recurring-payment discovery and isolated recovery were added in `b5f5cd4` / `e43605b`. Current repository schedule remains the daily full invoice cron at `0 3 * * *` UTC. Current deployment must be verified separately.

Decision recorded on 8 October 2026: an additional recovery scheduler is optional, not an automatic next implementation task. Webhooks handle normal payment updates; the daily cron handles scheduled billing, delivery retries and fallback recovery. First verify the webhook flow and observe the fixed daily cron's scheduled execution. Add faster recovery only if waiting until the next daily run for a missed update is unacceptable.

If needed, start the separate sync-only job **every two hours**, replacing the earlier tentative 15–30-minute cadence. That is 12 runs/day, about 360 per 30-day month. A missed update would normally be recovered within roughly two hours, subject to successful execution and sufficient batch capacity; this is not a guaranteed recovery deadline.

Cost planning estimate only: if each run wakes an otherwise idle Neon compute at 0.25 CU for approximately five minutes, those wakeups use about **7.5 CU-hours per 30-day month**, excluding execution time and other activity. Actual compute sizing, autoscaling and overlap with normal traffic change the result. Measure usage before increasing frequency; current account headroom has not been established.

- [x] Verify daily scheduled completion through 22 October; no missing dates found.
- [x] Repair the two existing live subscriptions' dead webhook destinations. On 22 October, URL-only PATCHes returned 200; provider GETs verified the exact Kify URL and every other field unchanged. Secure rollback retained outside Git; all 33 application tables and seven historical payments unchanged. See issue 1 in the 22 October handoff.
- [ ] Observe the next genuine webhook and successful tenant-scoped processing before deciding whether shorter recovery is needed. URL correction and GET 405 do not prove delivery. No replay or early billing test.
- [x] Review the three managed live payment links with legacy destinations. Follow-up GETs on 22 October at 22:23 confirmed all three are already-paid, single-use April onboarding links. No new-payment repair needed; retain historical records unchanged. Mollie does not document webhook URL updates on payment links. Full evidence and the historical-status limitation are in the handoff.
- [ ] If justified, design a separate authenticated, bounded sync-only endpoint with overlap protection and monitoring, initially triggered every two hours.
- [ ] Keep invoice creation, payment collection and customer email out of that path; retain the daily full billing cron at its existing frequency.
- [ ] Verify recovery latency, batch capacity, resource usage and schedule execution. Independent missed-run monitoring remains a separate roadmap item.

This decision records the preferred starting cadence; it does not authorize implementation, deployment or schedule changes.

## Continuation log

- 2026-10-22, implementation follow-up: user authorized fixes, refreshed validation and separate local dependency/UI commits. Dependency-only `3c263b9`; UI fixes cover request identity/cancellation, payment-repair deduplication/throttling and lifecycle explanations. Clean install/build/typecheck, 518/518 tests, zero lint errors/warnings, SMTP and 8 local HTTP checks pass. Production audit zero; 13 development-only findings remain. No push/deployment or production actions. See [implementation evidence](security-dependency-fixes-2026-10-22.md).

- 2026-10-22, 22:29–22:33 Europe/Amsterdam: Completed the now-requested issue 4 review and validation refresh. Current production audit fails on Next.js 16.4.0 (one critical package entry / three advisories); recommend paired Next.js/eslint-config-next 16.4.2 and compatible ip-address 10.7.4. Clean install, build, typecheck, SMTP and local auth/access checks pass; full suite 510/511, lint 10 errors/11 warnings, full audit 15 entries. No application/dependency edits or production actions. See [current review](security-dependency-review-2026-10-22.md); push/deployment remain prohibited.
- 2026-10-22, 22:23 Europe/Amsterdam: On the user's payment-link follow-up, reverified ownership and usage state. All three flagged links are already paid and non-reusable; the earlier possible-new-payment warning was too broad. Closed the new-payment repair item with no provider/database mutations. Current update reference and SDK omit webhookUrl; no undocumented PATCH, archival, recreation or replay attempted. Documentation checkpoint only; issue 4 remains untouched.
- 2026-10-22, follow-up: user authorized a local documentation checkpoint commit before any later issue. Include the existing production-health notes and issue 1 repair evidence; no push, deployment or issue 4 implementation/review. Confirmed the deployed creation paths use the configured Kify webhook URL for new onboarding links and subscriptions; existing stale payment links remain a separate review.
- 2026-10-22: Completed read-only production health check. Cron runs and active-subscription payment completeness verified; no overdue live invoice backlog. Found obsolete provider webhook URLs returning `DEPLOYMENT_NOT_FOUND`. Recorded exact targets, remaining proof gates, pending security release and all operational decisions in the linked 22 October handoff. User requests issue 1 in a new chat, with issue 4 considered there later on request. Documentation only; no deployment or production mutation.
- 2026-10-22, 22:09 Europe/Amsterdam: Completed the subsequently authorized issue 1 repair: exactly two existing subscription `webhookUrl` fields changed to the query-free Kify endpoint. Preserved all other provider fields; authoritative GETs and before/after database fingerprints verified. No new webhook event observed. Recorded three separate payment-link findings without modifying them. Preserved checkout/worktree edits; no commit, push, deployment, billing, replay, email, or account changes. Stop after this handoff; do not begin issue 4 until asked.

- 2026-10-08: Created this roadmap after reading all three source chats and inspecting current diffs. Started step 1. Initial review found PDF amount verification uses a substring anywhere in document text, which does not prove the displayed final total. No production mutations performed.
- 2026-10-08: Completed local KOR review/hardening and refreshed validation. Reconfirmed original provider amounts, production deployment and checkout database state. Production DB identity and a controlled newly issued KOR PDF/delivery remain release gates. Next: isolate the KOR commit using the boundaries above, verify it independently, then proceed to the authorized release/configuration process.

- 2026-10-08: User requested reconsideration of PDF gating. Adopted API-only routine verification plus visual setup/template/tax-change review. Removed parser/hash gate and dependency, added fresh delivery API verification and tests, refreshed this roadmap/runbook. No side-chat implementation or configuration changes were assumed.
- 2026-10-08: Isolated and validated the scoped KOR commit at the user's request; retained independent cron work in the checkout. Next: confirm production database identity, migration/configuration order and prepare the controlled release. Deployment, configuration changes, historical corrections and customer delivery still require their separate authorized operational steps.
- 2026-10-08: Refreshed deployment, remote branch, configuration metadata, checkout migration/settings/backlog and candidate provider checks read-only. Prepared exact release/configuration/PDF/delivery sequence. Production DB identity remains blocked by write-only DATABASE_URL; asked the operator only for non-secret host/database confirmation. Found the existing global operator-recipient override and documented its sent-state consequence. No push/deployment, financial/configuration mutation or email; cron work preserved.
- 2026-10-08 13:25 Europe/Amsterdam: User requested independent verification while keeping deployment on hold. Confirmed production database connection by correlating three authenticated unscoped health requests with successive `select 1 as ok` query timestamps on the inspected Neon endpoint. Refreshed migration 0029, NULL tax treatment and unchanged backlog in a read-only transaction. Production and remote master remain `665599f`. Updated release evidence; no push, deployment, application/accounting/credential write, provider mutation or email. Next production action requires the user to lift the deployment hold and authorize the exact KOR release/configuration sequence.
- 2026-10-08: User waived the controlled live KOR test and requested a new-chat handoff for the next roadmap point: the four historical invoices. Deployment/configuration remain unapproved. Continue historical read-only investigation and local correction preparation; do not treat the waived test as successful live validation or skip verification of actual correction documents.
- 2026-10-08: User disclosed manual tax corrections. Read-only provider/API/PDF and Kify checks confirmed corrected EUR 19.99/zero-VAT totals and intact invoice/payment links. User subsequently confirmed adding the KOR notice to the template and sending corrected documents externally. Step 3 is resolved on that combined evidence; no historical repair tooling is needed. Recommended next action is the scoped KOR release/configuration with non-billing post-deployment checks, then the independent cron reliability work and finally Cloudflare sync-only recovery. User is considering that sequence; no deployment authorization has been given yet.
- 2026-10-08 14:08 Europe/Amsterdam: User pushed the KOR commit and set Ayal Web to KOR. Verified exact production SHA, READY deployment, settings/audit, health, migration and unchanged backlog read-only; no errors returned in the recent log window. Closed the deployment/configuration milestone while retaining the explicit live-test waiver. Next: cron reliability, then Cloudflare sync-only recovery. Added the user's AYAL/platform/tenant Mollie Connect ownership question to the main roadmap as later design work; no account reconfiguration or cron implementation occurred in this check.
