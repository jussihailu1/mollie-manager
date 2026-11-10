# e-Boekhouden Sales Posting Fix And Repair Preview

Date: 8 November 2026, Europe/Amsterdam
Status: local implementation and read-only preview; not deployed or applied

Continuation, 10 November: the original dates of F00037/F00038 were reviewed and
must remain 1 June 2026. Their original terms and emails already identify their
June/October collections; the preview fallback used scheduled send dates because
historical snapshots lack invoice dates. Three review findings are fixed locally;
see [the review fixes and validation](eboekhouden-posting-review-fixes-2026-11-10.md).
The dated preview below remains unchanged and unapplied, including its two holds.
A [later full read-only scan](eboekhouden-release-preparation-2026-11-10.md)
records those two date reviews explicitly and proposes all ten original-date
sales entries. That new report does not replace or apply this historical preview.

## Authorized Scope

Implement future e-Boekhouden invoice sales posting, prepare a read-only repair
preview and update the roadmap. Preserve all earlier uncommitted work. No
deployment, migration, financial entry, account/permission change or invoice
creation/resend was performed against production.

## Local Change

The shared invoice client sends the documented `mutation` object in the same
invoice creation request. It resolves exactly one tenant-administration ledger
with category `DEB`, validates the invoice line ledgers, and uses the existing
stable FP/RB reference as `paymentReference` with `checkPaymentReference: true`.
An absent/ambiguous debtor mapping fails before invoice POST. No schema migration
is required for this correction.

First-payment and recurring issuance/recovery retain their row claims, exact
reference lookup and uncertain-write/manual-review guards. They additionally
verify one type-2 sales mutation against invoice identity, relation, date,
debtor ledger, revenue amounts and VAT before recording success or delivery.
Missing/mismatched/duplicate postings require manual review; recovery never
creates a second invoice or silently adds a standalone sale. Existing delivery
retries do not initiate posting or repair. A `GEEN` zero-VAT sale may use either
IN or EX with identical amounts; nonzero-VAT basis differences require review.

Full-page scans continue until a short page: the API's `count` means retrieved
items, not total available rows. Truncated/malformed scans do not justify writes.
The new ledger/mutation scans reject repeated IDs and enforce a bounded limit.

Official contract checked on 8 November:
[e-Boekhouden OpenAPI](https://api.e-boekhouden.nl/openapi/v1.json),
`POST /v1/invoice` → `mutation`, `GET /v1/mutation` and `GET /v1/mutation/{id}`.
Tests mock financial POSTs; no live combined invoice/posting proof has been run.

## Fresh Historical Preview

The command uses PostgreSQL `REPEATABLE READ READ ONLY`, verifies the read-only
setting, rolls back, and performs accounting GETs only. `POST /v1/session` is
used solely for authentication. It has no apply/replay/delivery option and
rejects unknown flags, including `--apply`.

The scan covers all available years: 276 mutation headers and details, 56 invoice
documents, 44 ledgers and 14 outstanding debtor entries. The earlier 74-entry
snapshot covered 2026 only; the larger count is not evidence of newly created
entries. Matching checks include paid sales and possible manual/bank revenue,
payment references, credit documents and local owner/document discrepancies.

| Invoice | Document date | EUR | Preview |
| --- | --- | ---: | --- |
| F00037 | 2026-06-01 | 19.99 | Review: current schedule expects 2026-06-05 |
| F00038 | 2026-06-01 | 24.90 | Review: current schedule expects 2026-09-26 |
| F00039 | 2026-04-10 | 19.99 | Missing sale; proposed payload |
| F00040 | 2026-05-05 | 19.99 | Missing sale; proposed payload |
| F00048 | 2026-07-05 | 19.99 | Missing sale; proposed payload |
| F00049 | 2026-08-05 | 19.99 | Missing sale; proposed payload |
| F00051 | 2026-09-05 | 19.99 | Missing sale; proposed payload |
| F00053 | 2026-10-05 | 19.99 | Missing sale; proposed payload |
| F00055 | 2026-10-27 | 24.90 | Missing sale; proposed payload |
| F00057 | 2026-11-05 | 19.99 | Missing sale; proposed payload |

No matching sales entry was found for any of the ten documents (EUR 209.72).
Eight proposals total EUR 164.83; two held documents total EUR 44.89. The held
documents' amounts, references and customer links agree. Their legacy stored
snapshots lack issuance dates, so the preview compares against current schedules;
this discrepancy does not establish which date should be corrected. Do not
silently change either document or schedule. F00057's planned collection date
is 10 November; posting its sale does not imply receipt of payment.

Verified mappings: debtor code 1300 / ID 34216536 (`DEB`), revenue code 8010 /
ID 34216546 (`VW`). Proposals retain each original invoice's number, date,
customer relation, payment term, VAT basis, GEEN code and original line ledger.
They contain sales mutations only, never invoice recreation, receipts, fees or
payouts. No proposed entry was submitted.

Private detailed report (outside Git):
`C:\Users\Jussi\Kify-Recovery\2026-11-08-invoice-posting\sales-posting-preview-final.json`.

Run a new preview with an unused private output path:

```powershell
node --import tsx scripts/preview-eboekhouden-sales-posting.ts --tenant-id TENANT_ID --mode live --env-file .env.vercel-production --output C:/PRIVATE/new-preview.json
```

The output is sensitive accounting evidence, not a file to commit. Existing
output files are never overwritten. Provider reads are not an atomic snapshot;
arbitrary unreferenced aggregate manual corrections cannot be ruled out by
matching alone. Recheck current entries and accounting-period availability
before any later repair. Closed-period status has not been proven by a write.

## Connector Decision And Remaining Work

PSPbetalingen advertises EUR 60/year and a 30-day trial. Its matching requires
existing sale postings and recognizable payment references; it explicitly does
not post Mollie transaction costs or bank payouts. Current Kify payments have
service descriptions and shared subscription/customer metadata, not per-invoice
F/FP/RB references. Native e-Boekhouden payment links are configured, but no
separate import connector was evidenced; the user knows of no external account.
No connector was purchased or activated.

Sources: [pricing](https://www.pspbetalingen.nl/prijzen),
[manual](https://handleidingen.pspbetalingen.nl/handleiding-molliepay-eboekhouden),
[fees and payout exclusions](https://faq.webwinkelfacturen.nl/content/64/369/nl/hoe-boek-ik-de-betaalkosten-_-transactiekosten-van-mollie.html).

Recommended first setup: Kify owns sales and linked gross receipts; e-Boekhouden
owns reviewed monthly fee invoices, bank transfers and exceptions. Receipt
posting remains a separate unimplemented slice. Each financial entry has one
writer; do not activate a payment connector alongside a Kify receipt writer.
Optional `balances.read`, `settlements.read`, `invoices.read` are unnecessary for
this limited setup; retain their local implementation but defer migration 0030
and live authorization until Kify needs automated financial-report retrieval.

Next gates:

1. Review F00037/F00038 legacy dates and verify the proposed historical mappings.
2. Review and explicitly authorize a controlled production release separately
   from financial repair; existing queued invoices can create postings after release.
3. Prepare any historical apply operation separately, with fresh duplicate checks,
   original document preservation and verification of the resulting sales entries.
4. Implement gross-receipt posting under its own scope, then reconcile fees,
   payouts and exceptions. Kify-native invoice accounting sync remains separate.
5. Keep JHS deferred; complete merchant onboarding safeguards/M6 before expansion.

## Validation

The final full Node suite passed (678 tests). TypeScript and focused ESLint passed;
33 relative documentation links and `git diff --check` also passed.
Coverage includes invoice request shape, ledger/reference validation, KOR and
standard VAT, duplicate/uncertain POST outcomes, issuance/recovery verification,
historical existing/manual/credit cases and complete pagination. The final suite
also covers equivalent IN/EX zero-VAT postings and the held legacy dates.
No tests created live invoices, financial entries or emails.
