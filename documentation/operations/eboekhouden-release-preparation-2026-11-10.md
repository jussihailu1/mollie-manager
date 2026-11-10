# Invoice Posting Release Preparation And Historical Correction Plan

Date: 10 November 2026, Europe/Amsterdam
Status: prepared locally; deployment, migrations and financial writes remain unauthorized

## Refreshed Historical Preview

At 22:41:48 UTC, the read-only scan again read all 276 mutations, 56 invoice
documents, 44 ledgers and 14 outstanding debtor entries. It used an enforced
PostgreSQL read-only transaction, 336 accounting GETs and one authentication
session. No invoice, mutation, receipt, delivery or database write was performed.

The result is **ten missing sales postings, EUR 209.72**, with no duplicate or
correction candidate found by the implemented checks. The eight previously
proposed payloads are unchanged. F00037/F00038 now have explicit original-date
evidence rather than an unexplained schedule-date mismatch. The earlier dated
preview and its two holds remain intact as historical evidence.

| Invoice | Original date retained | EUR | Date evidence |
| --- | --- | ---: | --- |
| F00037 | 2026-06-01 | 19.99 | Reviewed early issuance; 9-day term, collection 10 June |
| F00038 | 2026-06-01 | 24.90 | Reviewed early issuance; 122-day term, collection 1 October |
| F00039 | 2026-04-10 | 19.99 | Local/provider match |
| F00040 | 2026-05-05 | 19.99 | Local/provider match |
| F00048 | 2026-07-05 | 19.99 | Local/provider match |
| F00049 | 2026-08-05 | 19.99 | Local/provider match |
| F00051 | 2026-09-05 | 19.99 | Local/provider match |
| F00053 | 2026-10-05 | 19.99 | Local/provider match |
| F00055 | 2026-10-27 | 24.90 | Local/provider match |
| F00057 | 2026-11-05 | 19.99 | Local/provider match |

The proposed debtor mapping remains code 1300 / ID 34216536 (`DEB`), with the
original revenue lines on code 8010 / ID 34216546 (`VW`). Original references,
relations, numbers, payment terms, VAT basis and `GEEN` amounts are retained.
These are sales-only proposals, not confirmation of payment or period availability.

## Explicit Date Evidence

The preview accepts an optional `--reviewed-dates PRIVATE_PATH`. Its versioned
JSON manifest is restricted to one tenant and mode and has purpose
`read-only-sales-posting-preview`. Each review binds one local/provider invoice
ID, number, relation, reference, amount/currency, scheduled date, original date,
payment term and collection date. Duplicate or unused identities, malformed
dates, inconsistent terms and unexpected fields are rejected. Changes in the
bound local/provider values put the invoice back on hold.

Evidence consists of the original-document review and provider-read artifacts,
identified by path and SHA-256. The original June notifications and creation
audit corroboration are described in that review. The report includes the
manifest, its SHA-256, accepted reviews and original identity differences.
Evidence hashes provide provenance, not permission to post. A date review only
explains the date mismatch; all posting, duplicate, credit, ledger and amount
checks still run. It never updates local invoice snapshots or provider documents.

```powershell
node --import tsx scripts/preview-eboekhouden-sales-posting.ts --tenant-id TENANT_ID --mode live --env-file .env.vercel-production --reviewed-dates C:/PRIVATE/reviewed-original-dates.json --output C:/PRIVATE/new-preview.json
```

Without the manifest, the two legacy discrepancies remain held. There is no
apply option. Private evidence is outside Git under
`C:\Users\Jussi\Kify-Recovery\2026-11-10-release-preparation`:

- `reviewed-original-dates.json`: two narrowly scoped original-date reviews;
- `sales-posting-preview.json`: fresh report and ten proposed payloads;
- `release-files.json`, `posting-release.patch`: exact local release scope;
- `posting-release`: isolated checkout based on `a80fd1c`;
- `before`, `baseline.json`: backup and hashes of all 60 pre-existing dirty files.

## Release Scope And Checks

The isolated checkout includes the invoice client/posting verification,
issuance/recovery and frozen-date changes, preflight retry classification,
associated metrics/requeue selection, read-only preview and tests/documentation.
It excludes all optional Mollie consent/OAuth/UI changes, `db/schema.ts`, migration
0030 and migration metadata. No schema migration is needed for this posting fix.
The original workspace and all deferred work remain in place. No commit, push
or deployment was made.

Validation: the complete working-tree Node suite passed **708 tests**. The
isolated release passed **677 tests**; its lower count excludes 31 tests belonging
to the deferred Mollie bookkeeping scope. Both TypeScript checks passed. The
eight new date-review/CLI cases verify preserved dates and mismatch evidence,
strict tenant/mode/identity binding, stale reviews, unchanged duplicate/credit
guards, read-only DB/accounting boundaries, rejected apply flags and absent owners.
The previous recovery/preflight/date regressions remain passing.

The isolated production build also passed (`next build --webpack`, using the
shared dependency junction). Its environment contained a dummy build-only
`AUTH_SECRET`, no production credentials and no environment files. An initial
attempt without that required placeholder stopped at configuration collection;
the completed build passed compilation, TypeScript, page collection and static
generation. Changed-file ESLint, 22 relative documentation links and diff
whitespace checks passed. Build/test evidence remains in the private directory.

The test suite uses mocked financial boundaries. Live combined invoice/posting
behavior and first-sample PDF/delivery verification remain open.

## Controlled Release: Later Authorization Required

1. Review the isolated patch and compare its base with the production revision
   at release time. Keep the deferred OAuth/schema work out of the release.
2. Agree a bounded release window, tenant, one legitimate next invoice and its
   PDF/customer-delivery review procedure. Read the current pending/failed queue
   before activation. Existing creation jobs can create financial entries as soon
   as the new version is active; deployment authorization must cover this effect.
   Do not deploy under a continuing prohibition on financial entries.
3. After explicit authorization, deploy only the reviewed release. Verify one
   invoice and exactly one matching type-2 sale through fresh GETs, including
   date, relation, reference, amount, VAT, debtor and original revenue lines.
   Inspect its PDF and delivery result, then confirm a repeated recovery pass
   cannot create another invoice or sale. Do not create fictitious live invoices.
4. If proof fails or a financial request has an uncertain outcome, stop the
   affected issuance triggers under the agreed incident procedure and preserve
   upstream IDs/evidence for reconciliation. Do not blindly replay. Reverting
   code does not undo accounting entries, and the old version can issue documents
   without their sales posting; rollback alone is not a complete recovery.

No production controls were changed during this preparation.

## Historical Correction: Separate Later Authorization Required

The concrete proposed scope is the ten sales entries in the table, totaling
EUR 209.72, using their original dates/documents. It excludes invoice recreation,
redating, customer messages, receipt postings, fees, payouts and local state resets.
No historical writer has been implemented or run.

Before authorization, obtain accounting-period review and check for unreferenced
aggregate/manual corrections that automated matching cannot exclude. Provider
reads are not an atomic snapshot. Immediately before any later apply operation,
repeat the complete preview and compare every proposed payload with the reviewed
report. Any new match, changed source, held item or amount/date change stops it.

A later separately reviewed writer must use the stable reference with uniqueness
checking, perform fresh duplicate checks for each item, record any returned
mutation ID, verify it against the original document and reconcile uncertain
responses before retry. A successful repeat must skip an already matching sale.
It must never create or resend an invoice to repair a missing sale.

Sales postings do not settle payments already collected. Gross-receipt posting
and reconciliation remain separate work; review resulting debtor balances before
using them for customer statements or collection actions. Keep PSPbetalingen
inactive, JHS review deferred and optional Mollie bookkeeping consent/migration
0030 out of this scope.
