# Temporary billing recovery roadmap

Updated: 2026-10-08. Working checklist for completing the concurrent Kify investigations sequentially. Remove or archive after completion; keep permanent behavior in the invoice runbooks.

## Scope and working rules

Work from this chat, one topic at a time. Preserve existing changes and use separate, dependency-complete commits. Some files contain both KOR and cron changes: stage individual hunks rather than whole overlapping files. Do not commit the entire working tree. Commit, deployment, database changes, provider invoice changes, and customer delivery are separate milestones.

At initial handoff, all three source chats were idle. The checkout was on `master` at `665599f`, with 63 modified/untracked files before this document. This roadmap is included in the scoped local KOR commit, titled `Fix KOR invoice treatment and verify provider totals`; use Git history for its hash. Independent cron changes remain uncommitted. Nothing has been pushed or deployed by this continuation.

Sources:

- [Fix KOR invoice tax mismatch](thread://01a117a5-914b-7f41-b991-c7299ada4cc4?hostId=local)
- [Choose Kify reconciliation option](thread://01a00f84-208f-7310-a41e-e3c75f563c9a?hostId=local)
- [Investigate Kify notification alerts](thread://01a01440-facd-7f82-84a8-4686bed47f1e?hostId=local)

## 1. Finish and validate the KOR fix — LOCAL API-BASED REVIEW COMPLETE; RELEASE CHECKS OPEN

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
- [ ] Confirm production database identity and recheck its migration/settings/backlog before release. Production DATABASE_URL is redacted by Vercel, so equivalence to the checkout database is not proven.
- [x] Record changed-file ownership and a commit boundary, including shared cron result fields required by KOR verification (below).

Known release limitation: no newly issued live KOR invoice/PDF has been verified. Migration `0029_tenant_tax_treatment` is now confirmed by comparing its file hash to the latest applied migration in the database used by the checkout; this alone does not establish the production database state. New tax settings default to unset and block issuance until deliberately configured. No migration or billing setting was changed during this continuation.

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

The manual replacement helper belongs to the failed-attempt recovery safeguard. It is still **not** the historical correction implementation for step 3. The local KOR commit includes 54 files, using partial staging for the shared cron route, first-payment module and feature inventory. Eight modified tracked files and four new cron files remain outside this commit. No push or deployment has been performed.

## 2. Commit, release and verify KOR — LOCAL COMMIT COMPLETE; RELEASE PENDING

- [x] Prepare one coherent KOR commit including verification and retry safeguards, without independent cron routing/notification changes.
- [ ] Review migration and configuration order. Confirm Ayal Web's tax treatment deliberately; deployment alone does not select KOR.
- [ ] Deploy the reviewed commit when authorized, confirm the actual deployed commit and settings.
- [ ] Verify one controlled legitimate invoice end to end: provider total/VAT, real PDF, Kify record and customer delivery. Do not create a fictitious live invoice just to test.

## 3. Correct the four historical invoices — PENDING, separate operation

- [ ] Re-read each original invoice, PDF, delivery and payment allocation before proposing exact corrections.
- [ ] Prepare a reviewable correction procedure preserving original documents and accounting history, including credit/replacement links and existing payment allocations.
- [ ] Address the Kify data model for correcting invoices already successfully recorded and sent.
- [ ] Dry-run and review the proposed corrections before an authorized apply/delivery step; verify all resulting states afterwards.

Important: `scripts/recover-credited-eboekhouden-invoice.ts` only accepts owners in `invoice_failed` with a matching unverified upstream invoice identity. It does not implement historical correction of successfully recorded/sent invoices. Do not force those invoices into a failed state to reuse the command. The command records a credit note number but cannot independently prove that credit was issued.

## 4. Finish cron reliability fixes — PENDING, separate commit

Already prepared locally: Kify first-payment routing bypasses the legacy provider adapter; empty repair batches no longer report failure; genuine/partial failures are counted; consolidated cron issue notifications use `ALERT_EMAIL_TO`. Previous chat reports saved configuration `info@ayalweb.com`, but production configuration and delivery need verification.

- [ ] Review and test routing for an active Kify provider tenant, empty batches, partial failures and notification failures.
- [ ] Keep notification failure from causing billing replay; verify recipient configuration without exposing secrets.
- [ ] Commit independently, deploy when authorized and verify a scheduled run and issue-email behavior.
- [ ] Keep independent monitoring as a separate roadmap item: a job cannot report its own failure to start.

JHS retirement is removed from scope. Latest user update reports JHS cleanup complete: 380 JHS-only production records deleted after an encrypted backup, retained records across 33 tables unchanged, only Ayal Web visible. Backup location: `C:\Users\Jussi\Kify-Recovery\2026-10-08-jhs-cleanup`. This continuation has not reverified that operation. Fix the provider bug independently of JHS removal. Controlled live Kify-provider invoice proof (K7) and final documentation (K8) remain later milestones.

## 5. Faster Cloudflare recovery — PENDING, last

Timestamp-only stale alerts were already removed in `a56566d`. Recurring-payment discovery and isolated recovery were added in `b5f5cd4` / `e43605b`. Current repository schedule remains the daily full invoice cron at `0 3 * * *` UTC. Current deployment must be verified separately.

- [ ] Design a separate authenticated, bounded sync-only endpoint with overlap protection and monitoring.
- [ ] Trigger it from Cloudflare at the chosen cadence (previous discussion: 15–30 minutes).
- [ ] Keep invoice creation and customer email out of that faster path; do not simply increase the full billing cron frequency.
- [ ] Verify recovery behavior, schedule execution and missed-run monitoring.

## Continuation log

- 2026-10-08: Created this roadmap after reading all three source chats and inspecting current diffs. Started step 1. Initial review found PDF amount verification uses a substring anywhere in document text, which does not prove the displayed final total. No production mutations performed.
- 2026-10-08: Completed local KOR review/hardening and refreshed validation. Reconfirmed original provider amounts, production deployment and checkout database state. Production DB identity and a controlled newly issued KOR PDF/delivery remain release gates. Next: isolate the KOR commit using the boundaries above, verify it independently, then proceed to the authorized release/configuration process.

- 2026-10-08: User requested reconsideration of PDF gating. Adopted API-only routine verification plus visual setup/template/tax-change review. Removed parser/hash gate and dependency, added fresh delivery API verification and tests, refreshed this roadmap/runbook. No side-chat implementation or configuration changes were assumed.
- 2026-10-08: Isolated and validated the scoped KOR commit at the user's request; retained independent cron work in the checkout. Next: confirm production database identity, migration/configuration order and prepare the controlled release. Deployment, configuration changes, historical corrections and customer delivery still require their separate authorized operational steps.
