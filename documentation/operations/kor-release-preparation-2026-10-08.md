# KOR release preparation — 8 October 2026

Status: **released by the user; deployment and settings verified read-only at 14:08 Europe/Amsterdam on 8 October 2026.** At that verification, production and remote master were on `81ac2fea62be7698335f310b98e5aa597d49df52`, READY Git deployment `dpl_2x3GKwfuCCTuiaDcBezZYGMXKEJC`. Ayal Web settings are `kor / GEEN / 0.00`, provider `eboekhouden`, template `1543946`, ledger `34216546`, delivery `app_smtp`; a successful settings audit is recorded at 14:04:52. Migration 0029 and backlog remain unchanged. Authenticated unscoped health returns 200/OK, and no error/fatal logs were returned for the inspected 15-minute window. No billing cron, new invoice or email was triggered by verification. The controlled live invoice test remains waived. The preparation and approval language below records the earlier release plan; it does not authorize repeating production actions.

## Read-only evidence

Checked at 12:44–12:46 Europe/Amsterdam on 8 October 2026.

| Item | Observation |
| --- | --- |
| Local release commit | `81ac2fea62be7698335f310b98e5aa597d49df52` |
| Remote `master` | `665599f154475b2d10db66edc5cdca1e5e308b5e` |
| Production alias | `kify.app`, READY deployment `dpl_GToDu22bwhDKchyiun8RPUaFC8nd`, same `665599f` commit |
| Vercel project/team | `prj_DO7AjYeMLNuQ6BW8WtgWvsGxNdbv` / `team_Bv4Mnsq4nacXWEj1H5efabqO` |
| Git deployment | GitHub `jussihailu1/mollie-manager`, production branch `master`, deployment creation enabled. A push to master is a deployment-triggering action. |
| Production invoice override | `INVOICE_EMAIL_OVERRIDE_TO=info@ayalweb.com`; alert recipient also `info@ayalweb.com` |
| Production cron | `/api/cron/recurring-invoices`, `0 3 * * *` UTC. Do not invoke this full billing job as a release test. |
| Database identity limitation | Production `DATABASE_URL` is type `sensitive`. Both CLI export and the individual-variable API with CLI credentials fail to reveal its value. The connector's environment-list operation returned 403; CLI metadata reads succeeded. No production credential was changed. |

Vercel treats these secrets as write-only after saving ([official documentation](https://vercel.com/docs/environment-variables/sensitive-environment-variables)). A redacted value is not evidence that the checkout points to another database, or that it points to production. The runtime verification below resolves the connection without operator recollection or secret disclosure. Never replace the secret merely to make it readable.

The following checks initially used **the checkout connection**, in a PostgreSQL repeatable-read, read-only transaction. The runtime verification below establishes that the running production app uses the same Neon endpoint/database; migration, tax settings and backlog were refreshed there at 13:25:

- Host: `ep-shy-paper-alzgigh2-pooler.c-3.eu-central-1.aws.neon.tech`; database `neondb`; role `neondb_owner`.
- Migration 0029 SHA-256: `13175154be98a09cb1d46d1240e13b1c7754d4dc442c55280004ae7b63063b0a`. It matches the latest Drizzle record (ID 37). The nullable column has no default, and the `kor`/`standard` check constraint is validated.
- Ayal Web tenant: `ffdbb026-41cf-4295-876c-324d9906f6e0`. Provider `eboekhouden`; treatment NULL; VAT code `HOOG_VERK_21`; percentage `21.00`; delivery `app_smtp`.
- Template `1543946`; revenue ledger `34216546`. Provider GETs confirm active template **Factuursjabloon maandelijks** and ledger code **8010**, description **Omzet groep 2**, category `VW`. Kify's cached ledger label is **Omzet abonnementen**; retain the verified ledger ID, do not silently select a different ledger by label.
- No live first-payment rows in pending/failed/creating invoice states. Three paid test first-payment rows remain pending; they are excluded from this release proof.
- One live recurring row is pending; no recurring failed/creating rows. No created-but-unsent payment or schedule invoices.
- All four historical original invoice records remain present. They were not modified or newly reverified at the provider in this continuation.

### Runtime connection verification — 13:25 Europe/Amsterdam

The user could not independently confirm the configured connection and explicitly authorized read-only verification while retaining the no-deployment instruction. Their Neon screenshots identify `ep-shy-paper-alzgigh2` as the production branch's primary compute.

Used the existing authenticated **unscoped** `GET https://kify.app/api/health`, whose deployed `665599f` code executes `select 1 as ok`. Observed `pg_stat_activity` from a separate direct connection to `ep-shy-paper-alzgigh2.c-3.eu-central-1.aws.neon.tech`, database `neondb`, with `default_transaction_read_only=on`. Using the direct monitoring connection avoids overwriting the observed query by reusing its pooled backend. The monitor itself never executed the health-check SQL.

Three sequential production requests all returned HTTP 200 and `checks.database.ok=true`. The separate pooled backend (PID 595) showed the exact health SQL and advanced its `query_start` once for each request:

| Production request ID | Observed database query start (UTC) |
| --- | --- |
| `fra1::iad1::9c4rr-1791458708101-99d58a161dc8` | `2026-10-08T11:25:08.884Z` |
| `fra1::iad1::5b87z-1791458709064-3be87abd88b6` | `2026-10-08T11:25:09.188Z` |
| `fra1::iad1::kpl8j-1791458709370-0126251b281d` | `2026-10-08T11:25:09.495Z` |

Before these requests the backend's last health query was `11:24:38.595Z`. This repeated runtime correlation establishes the production app's connection to the inspected endpoint/database; it does not reveal or compare the complete Vercel connection string. Neon reports the pooled backend client address as localhost, so that address is not being used as Vercel identity evidence. The production alias was independently rechecked and still serves READY `665599f`.

The subsequent read-only database snapshot reconfirmed migration 0029 hash/nullable column/validated constraint; NULL treatment, `HOOG_VERK_21`/`21.00`; three pending test first-payment rows; one live EUR 24.90 recurring invoice due 27 October; no live failed/creating rows; zero created-unsent payment or recurring invoices. No migration is currently needed.

Avoided tenant-scoped health checks: their Mollie authentication path can refresh OAuth credentials, and the inspected token was expired. Unscoped health checks do not enter that path. Runtime log search had no matching Neon entries in the available 15-minute window; a wider query exceeded retention. `pg_stat_statements` was unavailable and was not installed. No application/accounting rows, credentials, settings, provider documents or emails were changed. Local detailed evidence: ignored `tmp/kor-runtime-link-evidence.json`; the durable evidence is the table and findings above.

## Exact release and configuration order

1. **Database identity gate resolved:** use the runtime evidence above. Recheck if deployment/connection configuration changes before release; no further operator recollection is required. Use only the verified endpoint/database for production database operations.
2. Recheck remote master, production alias, migration hash, settings, backlog, and in-flight `invoice_creating` rows immediately before release. A changed snapshot needs review. Use a quiet release window outside the scheduled billing run. Do not run batch recovery, requeue, test-mode issuance, or broad delivery retries.
3. **Migration:** if production has the same 0029 hash, column, and validated constraint, no migration is needed. If missing, first inspect all pending migrations, then seek authorization for that exact list. Only then run `npm run db:migrate` from a clean copy of the approved commit with the confirmed production connection. Do not blindly rerun the raw ALTER TABLE or assume only 0029 is pending.
4. **Push the exact KOR commit**, after production-action approval. Do not stage cron work or deploy the mixed checkout. Recheck remote master is still the expected parent; if it advanced, stop and review rather than force-push.

   ```powershell
   git ls-remote origin refs/heads/master
   git push origin 81ac2fea62be7698335f310b98e5aa597d49df52:refs/heads/master
   ```

   Git integration should create the production deployment. Observe it; do not also start a CLI deployment. If it fails to trigger, diagnose and prepare a clean-commit deployment before proceeding. Confirm `kify.app` actually points to READY code with the full approved SHA. Preserve NULL treatment until the new code is active; on the new code it blocks issuance. The old deployed code does not provide that NULL-treatment safeguard.
5. **Configure Ayal Web through the new production `/settings` UI**, which records the normal settings audit event. Select provider **e-Boekhouden**, treatment **KOR**, template **1543946**, ledger **34216546**, delivery **app_smtp**. Save once. Re-read the row and audit evidence: `tax_treatment=kor`, `vat_code=GEEN`, `vat_percentage=0.00`, all IDs/provider retained. The user's confirmed KOR participation is the basis for this setting; no effective date is invented.
6. Keep production `INVOICE_EMAIL_OVERRIDE_TO=info@ayalweb.com` for the controlled setup review. It redirects **all** invoice emails, not just the sample. Do not remove it globally as part of this limited release. Removing it to enable ordinary customer delivery is a separate explicit production configuration decision and redeployment; first review any invoices marked sent to the operator.
7. Re-read readiness/backlog using the new deployment and confirmed database. No invoice should have been created merely by saving settings. Record deployment ID/SHA, configuration/audit timestamp, migration evidence, and any new backlog.

If deployment or configuration fails, stop issuance work and inspect resulting state. Do not automatically roll back to the known incorrect invoice-creation code, revert accounting records, or reset claimed rows. A necessary rollback must include a reviewed way to prevent billing side effects.

## One legitimate invoice: exact candidate and timing

**Superseded as a release requirement:** on 8 October the user waived this controlled live test and requested moving to historical correction preparation. Retain the procedure below for reference only; do not execute it or wait for its candidate. No live KOR issuance validation occurred. The user subsequently released the code and configured KOR; historical correction findings are recorded below.

| Field | Prepared value |
| --- | --- |
| Tenant / mode | Ayal Web `ffdbb026-41cf-4295-876c-324d9906f6e0` / `live` |
| Schedule | `bfcda908-74cb-4e1c-ab19-2446bff25ab8` |
| Subscription | `56dab6aa-fc97-47f4-ba73-b60fc3cd7b24` |
| Customer | Kruispunt Welzijn, `e85f94b0-db0a-43bd-b318-1476f557acb4` |
| Intended customer email | `zorgadministratie@kruispuntwelzijn.nl` |
| Description | `kruispuntwelzijn.nl \| Technisch support` |
| e-Boekhouden relation | `68815943`, Kruispunt Welzijn, active |
| Invoice date / collection | 27 October 2026 / 1 November 2026 |
| Gross / VAT | **EUR 24.90 / EUR 0.00** under KOR |
| Deterministic reference | `RB-bfcda908-261101` |
| Provider reference search | No match on 8 October; must be repeated before issuance |

There is **no invoice due now** in the inspected backlog. Do not issue this invoice early with a future date merely to test. The single-owner function itself does not enforce the due date, so the operator must. Use this candidate when it becomes due, or select a newly arising legitimate due invoice after checking it in full. A different candidate needs its own recorded amount, relation, reference, recipient and dates. Historical replacement invoices belong to the next operation and must not be silently substituted here.

### Controlled execution, after separate invoice/delivery approval

1. Run from a clean copy of the approved KOR code with the confirmed database, tenant credential encryption key and SMTP configuration. Immediately re-read the candidate, subscription status/amount, customer, provider link, manual-review flag, stored invoice, provider reference, and prior delivery/audit records. Assert live mode, confirmed tenant, due date reached, agreed amount, KOR configuration and approved recipient. Abort on drift, ambiguity, a manual-review hold or an in-flight claim.
2. Use a process-local `INVOICE_EMAIL_OVERRIDE_TO=info@ayalweb.com`, established **before importing** modules that capture `env`. Invoke only `createEboekhoudenInvoiceForSchedule('bfcda908-74cb-4e1c-ab19-2446bff25ab8', { tenantId: 'ffdbb026-41cf-4295-876c-324d9906f6e0', actor: { kind: 'user', email: 'info@ayalweb.com' } })`. This is a live financial action. It creates/reconciles one invoice and immediately attempts operator delivery. Never call it just to inspect or dry-run.
3. If cron already handled that owner, do not create again. Inspect the existing identity and delivery outcome. If uncertain after a timeout, inspect provider/reference and database before retrying. Do not reset the state to pending. A successful creation result alone does not prove email success: inspect delivery metadata and SMTP evidence separately.
4. Confirm exactly one canonical invoice linked to this owner. Fresh provider API evidence must show the correct invoice ID/number, relation `68815943`, reference `RB-bfcda908-261101`, total `24.90`, VAT `0`, and frozen KOR issuance evidence. The request uses `inExVat: IN` and `GEEN`.
5. Download the PDF URL from that verified invoice through the existing trusted attachment checks. Visually inspect every page for issuer/customer identity, invoice number/date, total **EUR 24.90**, zero VAT, and the KOR notice. Confirm the operator's actual email attachment represents that invoice. Record template ID, treatment, sample number, date, reviewer and outcome. No automated PDF text parser or identical-file-hash gate.
6. Operator delivery sets `invoice_state=invoice_sent` and `invoice_sent_at`, even though the customer has not received it. Preserve `invoiceRecipientOverridden`, intended/effective recipient and audit evidence. Do not interpret sent state as customer proof or expect the unsent retry queue to pick it up later. `invoiceEmailDeliveryMode=none` is also not a pause mechanism in this e-Boekhouden workflow.
7. After the visual check passes, prepare a **fresh, single-owner delivery process** with the global production configuration untouched. Load its secure environment, remove `INVOICE_EMAIL_OVERRIDE_TO` from that process **after environment loading and before dynamically importing** `lib/invoice-delivery`, then call `deliverCustomerInvoiceEmail` with the stored provider invoice ID/number and the verified candidate fields (`entityId`=schedule, `invoiceType`=`recurring`, provider=`eboekhouden`, tenant/mode/customer/subscription/date from the table). This sends the existing invoice through fresh API verification; it does not create another invoice. Immediately before sending, require matching issuance identity, successful visual-review evidence, and no prior successful customer delivery in metadata/audit/SMTP records. This is an explicitly authorized one-time customer email, not a repeatable smoke test. Prepare and review the executable invocation with the assigned invoice ID/number after issuance; those values do not exist yet.
8. Verify SMTP acceptance and the resulting `invoice.delivery` audit event: intended and effective recipient are both `zorgadministratie@kruispuntwelzijn.nl`, override false, attachment present, same provider invoice identity. Check mailbox/provider delivery or customer receipt where available. SMTP acceptance and an `invoice_sent` timestamp alone do not prove inbox receipt. On ambiguous send outcome, inspect SMTP/mailbox evidence before any retry.

The controlled live proof is **waived, not performed**, by the user's subsequent decision. Deployment/configuration approval does not imply approval to send a future or substitute invoice. Do not mark the historical, cron, or Cloudflare milestones complete because KOR code was deployed.

## Approval boundary and next operations

The user has now completed the exact-commit release and Ayal Web KOR configuration, verified above. Do not repeat those changes. No migration was needed. The controlled live test remains waived, and no customer delivery was performed by this verification. Production recipient routing was not changed by this continuation; its last verified override was `info@ayalweb.com`.

Historical correction update: the user manually corrected F00048, F00049, F00051 and F00053 in place. Read-only API/PDF checks confirmed EUR 19.99 totals and zero VAT with unchanged identities linked in Kify. The user then reported adding the KOR notice to the template and sending the corrected invoices externally. No historical Kify repair or credit/replacement tooling is needed on these findings. The final template change and external sends are operator-reported. Preserve the original Kify delivery audit and do not resend or backfill verification automatically.

Subsequent release: cron reliability commit `1179c82` was deployed and verified at 14:54 Europe/Amsterdam; see [the cron release ledger](cron-reliability-release-2026-10-08.md). Next, observe its naturally scheduled execution and verify operator inbox receipt. Review the recipient override before ordinary customer delivery is expected. Additional Cloudflare sync-only recovery is optional after evaluating the existing webhook/daily-cron flow. Do not repeat the KOR release or configuration. JHS cleanup remains outside scope.

Existing isolated validation is unchanged: build/typecheck/lint passed; 470/471 tests passed, with the pre-existing customer lifecycle assertion failure. This preparation changes documentation only; it does not establish production behavior.
