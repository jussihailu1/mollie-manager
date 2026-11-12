# Automatic Mollie Gross Receipts

Date: 12 November 2026
Status: implemented; see the [release record](automatic-receipt-release-2026-11-12.md) for rollout evidence

This feature extends the deployed invoice sales-posting safeguards. It handles only
future payments against e-Boekhouden-issued invoices. Existing documents, dates and
completed historical repairs are preserved. It creates no clearing accounts.

The release is assembled from verified production with reviewed code and sanitized
documentation. Private financial reports, operator executors and the original local
history are excluded. Validation uses synthetic providers, ephemeral PostgreSQL and
a dummy build-only authentication secret. Genuine automatic receipt proof is separate.

## Durable Workflow

Receipt settings belong to one tenant and live mode. They specify an existing
financial clearing account, the expected Mollie profile, a payment cutover timestamp
and the version of the tenant's e-Boekhouden credentials. Missing/disabled settings
or changed credentials stop the workflow. Test-mode payments cannot post into the
live accounting administration.

Claims uniquely bind a tenant's payment, Mollie payment and existing invoice.
Composite database foreign keys enforce tenant/mode ownership. The original invoice
content and receipt payload are frozen before a write. Each claim has a time-limited
token; stale workers cannot submit or complete another worker's receipt.

The transport starts a fresh accounting session and awaits a durable `posting`
marker before one financial POST. Authentication failure before that marker can
retry safely. Once marked, an unknown outcome is reconciled by reading the provider;
an absent or ambiguous match remains held. No timer resets attempted work to prepared,
and a 401, redirect, timeout or invalid response never causes another receipt POST.
An accepted receipt must pass identity/date/amount/ledger checks, uniqueness and
outstanding-balance verification before local success is recorded.

## Separate Migration

`0031_eboekhouden_payment_receipts.sql` adds dedicated settings and receipt tables,
ownership constraints and indexes. It contains no OAuth `bookkeeping_context` column
and does not depend on the deferred local migration 0030. Its snapshot links directly
to 0029; the journal intentionally skips the reserved 0030 number.

**When the deferred OAuth work resumes, regenerate it as a new migration numbered
0032 or later, with a timestamp newer than 0031 and a new snapshot chain.** Drizzle
applies migrations by journal timestamp; inserting the old 0030 after applying 0031
would silently skip it. Keep the original uncommitted 0030 files preserved until
that separate integration is reviewed. Do not run the migration command from the
shared workspace for this release.

The new migration and claims are tested against an ephemeral PostgreSQL database
bootstrapped from the exact 0029 snapshot. Existing historical migrations are not
rewritten, and no production database is used for tests. That old SQL history has
a duplicate-index creation on an empty database; this validation proves the upgrade
from deployed 0029, not a fresh replay of the entire historical migration chain.

## Runtime And Review Visibility

`processPaymentReceiptsBatch` runs in the protected daily billing cron after invoice
creation/recovery, invoice delivery and activation notifications. It never runs from
the onboarding recovery endpoint or read-only payment synchronization. Each batch
processes at most five candidates with an explicit tenant and live mode.

`EBOEKHOUDEN_RECEIPT_AUTOMATION_ENABLED` must be exactly `true`, and tenant settings
must also be enabled. The global gate runs before accessing new tables. This makes
an initial deployment safe while the migration/configuration remain unapplied.

All unfinished durable claims stay in the work list even if their payment becomes
unpaid, the invoice is voided or its local ownership link disappears. A persisted
round-robin cursor advances after each outcome, including a review hold, so older
work cannot be starved by repeated newer holds. A settings/credential mismatch is
reported as a failure rather than silently treated as disabled. Tenant audits,
aggregate cron results and existing issue notifications expose failures, review
holds and remaining backlog. A cursor/audit failure does not erase completed counts.

Provider reads cover all pages for the invoice, payment reference and payment date,
including manual entries and paid receipts. Ambiguous matches remain held. Different
invoices for the same customer, amount and payment date are allowed only when the
other receipt independently matches a distinct owned Mollie payment. This still
requires a single writer per receipt; arbitrary unreferenced aggregate corrections
outside those matches require bookkeeping review.

## Configuration And Activation

The configuration command defaults to a verified preview. It checks the tenant's
current Mollie profile, an existing `FIN` ledger and freshly authenticated accounting
credentials. It creates no account, receipt or invoice. A new cutoff must be in the
future; historical payments remain outside this automatic rollout. Existing claims
prevent changing their account, profile, credential binding or cutoff.

After reviewing migration 0031 in this isolated checkout, apply it through the
normal migration command with the intended database environment. Confirm the relevant
payment periods are open in the e-Boekhouden administration and choose a future
cutoff timestamp with an explicit timezone. Preview configuration:

```sh
node --conditions=react-server --import tsx scripts/configure-eboekhouden-receipts.ts --tenant-id TENANT_ID --enable --profile-id PROFILE_ID --clearing-ledger-id LEDGER_ID --payments-from FUTURE_ISO_TIMESTAMP
```

Repeat that exact verified command with `--apply` to save settings and an audit
record atomically. Enable the global runtime flag on the intended production
deployment only when the migration, mapping and release checks are complete.
Resolve the intended tenant's own existing financial account. Never hardcode a
merchant-specific ledger into shared application code.

Observe the next genuine payment through the normal protected billing cron. Verify
one receipt, the Amsterdam payment date, unchanged invoice date, fully settled
outstanding amount, gross clearing movement and unchanged revenue. Do not manufacture
an invoice or payment for testing. Check the current schedule before observing the next genuine transaction.

To stop new writes immediately for one tenant:

```sh
node --conditions=react-server --import tsx scripts/configure-eboekhouden-receipts.ts --tenant-id TENANT_ID --disable --apply
```

Disabling preserves all claims and financial evidence. An already attempted receipt
still requires reconciliation; never delete its row, reset `attempted_at` or retry
its POST to clear a hold. Credential rotation or administration/profile changes
require an explicit mapping/evidence review; the command refuses to redirect existing
claims. Fees, payouts, refunds and unlinked historical payments remain
outside this feature.

See the [release record](automatic-receipt-release-2026-11-12.md) and
[roadmap](../product/implementation-roadmap.md).
