# e-Boekhouden Posting Review Fixes

Date: 10 November 2026, Europe/Amsterdam
Status: local implementation; no deployment, migration or financial writes

Continuation: [release preparation and a refreshed historical preview](eboekhouden-release-preparation-2026-11-10.md)
are now complete locally. That later scan records the two original-date reviews;
the implementation-stage results below remain as dated evidence.

## Scope And Preserved Work

The user authorized fixing the three review findings, testing them, keeping
original invoice dates and updating the roadmap. All prior uncommitted work was
preserved. A byte-for-byte backup of the 43 previously changed/untracked files
is retained privately at `C:\Users\Jussi\Kify-Recovery\2026-11-10-posting-fixes\before`.
No production calls, accounting entries, invoice creation/resends or emails were
needed for this implementation. Tests use isolated provider/DB/mail boundaries.

## Corrections

1. **Recovery enforces posting verification.** Both daily recovery batches and
   explicit replacement recovery require exactly one matching sales posting.
   Missing, duplicate, mismatched or unreadable postings remain on hold; success
   persistence and delivery are not reached. Delivery-only retries for invoices
   already issued still do not initiate accounting repair.
2. **Preflight failure is distinct from an uncertain financial write.** The client
   tracks whether the invoice HTTP request may have been sent, after session and
   ledger reads. Failures before that point are typed as preflight errors. Only
   transient failures (408/429/5xx, fetch network failure or abort/timeout) receive
   the safe-retry marker. Invalid mappings and permission errors do not. Any
   timeout/503 after invoice POST remains uncertain and held, including a failed
   token refresh after an initial request. Existing safe-retry filters, metrics
   and the standalone requeue selection recognize the new transient marker.
3. **Verification requires the intended invoice date.** Before issuance, the claim
   stores `invoiceExpectedDate` and `invoiceExpectedReference` in existing owner
   metadata. Creation retries and scheduled recovery reuse these values instead
   of recalculating from changed schedules/payment dates. Provider invoice reads
   must match the expected date as well as identity, amount and tax treatment.
   Sales-posting verification then checks the posting against that verified
   document. The verified snapshot stores its expected date for later delivery.

Older verified delivery snapshots may use their stored document date if the new
verification field is absent. Missing or conflicting date evidence requires
review; a fresh provider read or today's schedule is not silently accepted as
historical evidence. Legacy failed rows without a frozen claim retain their
existing planned-date lookup and require a matching document/posting. Explicit
replacement recovery keeps the date of the operator-selected replacement and
rejects changes between its two reads. None of these paths edits provider dates.

## Reviewed Historical Dates

| Invoice | Original date to retain | Scheduled send date | Original payment term | Collection date |
| --- | --- | --- | ---: | --- |
| F00037 | 1 June 2026 | 5 June 2026 | 9 days | 10 June 2026 |
| F00038 | 1 June 2026 | 26 September 2026 | 122 days | 1 October 2026 |

The 10 November read-only review found the same invoice dates and no matching
sales entries. Creation audits and original June emails already identify these
collection dates. Both records were created 1 June at 22:25 UTC (2 June 00:25 in
Amsterdam); the original invoice's date-only field is 1 June. This timing does
not authorize redating a document. The preview fell back to scheduled send dates
because the old local snapshots only stored invoice ID/number.

Keep both documents unchanged and record reviewed exceptions before a historical
repair. The 8 November preview remains eight proposals plus two holds. Neither
the preview script nor its stored output was rewritten to bypass those holds.
Fresh duplicate/correction checks and accounting-period review are still needed
before any later financial repair. The earlier full scan was not rerun here.

## Validation And Remaining Gates

Regression coverage exercises the actual scheduled batch functions, client,
creation workflows, verification and retry classification with external effects
mocked. It includes missing/duplicate/mismatched postings, changed provider dates,
frozen dates/references after schedule changes, transient preflight failures
followed by exactly one successful issuance, permanent preflight failures,
uncertain POST outcomes, replacement recovery, and legacy delivery dates.

Validation: all 700 Node tests passed (22 additional cases since the review),
TypeScript passed with `--noEmit --incremental false`, and ESLint passed on every
code file changed in this slice. The final regressions also cover failed token
refresh and retry after an initial invoice request. All 21 relative documentation
links checked and `git diff --check` passed. Logs remain in the private
`2026-11-10-posting-fixes` directory.
No live combined invoice/posting proof has been performed. Migration 0030 and
optional Mollie bookkeeping consent remain deferred and separate from this fix.
Deployment and historical financial repair each require a separately reviewed
scope. Customer-receipt posting remains unimplemented.
