# Onboarding and invoice reliability

The cent-consent path requires a valid future schedule, a working automatic mail configuration, provider settings and the customer accounting relation before link creation. e-Boekhouden relation verification also checks that the stored credentials can actually read the relation. Kify-native invoicing uses its tenant/customer profile readiness checks for both installment and mandate-only links.

New links have an explicit Mollie expiry, and public consent lookup blocks expired, closed, archived and already-paid checkout. The cutoff leaves the agreed invoice notice period and an extra recovery day before the daily invoice run. The default start date is eight days ahead. Changing a link to an invalid date is rejected before canceling its existing checkout. Provider expiry uses Mollie's documented [expiresAt field](https://docs.mollie.com/reference/create-payment-link).

Payment discovery continues to inspect accepted links after the planned start date, so an old paid setup is not silently abandoned. A late confirmation must never cause another setup charge or an unapproved change to agreed subscription terms. If the agreed date has already passed, the existing activation job/alert path requires schedule review using the original paid mandate.

Customer billing-profile email is the invoice recipient; the contact email is the fallback when no invoice email was supplied. This is shared by automatic creation, recovery, retry and manual resend queries. e-Boekhouden resend uses the external invoice identifier. Native Kify resend uses its local invoice identifier.

## Recovery and delivery guarantees

- A stale e-Boekhouden invoice claim is moved to reconciliation after 15 minutes, beyond the function execution window. Recovery first searches the original provider reference. One verified existing invoice is adopted; a complete no-match result requeues creation with the same reference. Ambiguous or unavailable provider results never trigger blind recreation. Both first-installment and recurring invoices are covered.
- Email sending has an atomic claim on the invoice owner. Concurrent jobs cannot send the same invoice. SMTP acceptance is recorded separately from the final owner/audit updates. Acknowledged sends are finalized by the five-minute timer without sending again.
- SMTP connection, greeting, socket and DNS waits are bounded. A second transport is allowed only for a timeout known to precede submission. A DATA timeout, process interruption during sending, or lost acceptance acknowledgment remains held for review. SMTP cannot provide exactly-once delivery after an ambiguous acknowledgment; never clear such a claim without checking the mail provider. This affects the email copy, not collection or invoice issuance.
- Manual resend explicitly permits an additional copy of a previously completed send, but cannot bypass an active or uncertain delivery claim.

## Independent monitoring

The existing Cloudflare five-minute timer calls the protected onboarding endpoint. Before onboarding work, that endpoint checks invoice automation independently of the daily invoice job. It also finalizes accepted-email persistence.

It alerts for a missed successful invoice run after 27 hours (allowing daily scheduling jitter), overdue unsent invoices, missing accounting links on due invoices, stale creation claims and uncertain email attempts. Alerts are deduplicated while unresolved and resolved when the condition clears. Details are recorded as `invoicing.watchdog` audit events. No new scheduler, GitHub workflow or secret is required.

The watchdog never creates invoices, starts collections or replays uncertain email. The daily invoice job performs reference-based recovery. An unresolved alert is an exception to investigate, not authorization to charge again.

## Verification

- `npm run test:node`: includes readiness, date/expiry, SMTP acceptance, concurrent-send, stale-claim reconciliation and watchdog regression cases.
- `npm run typecheck`, `npm run lint`, `npm run build`.
- Optional PostgreSQL integration check: `node scripts/verify-invoice-reliability-sql.mjs <env-file> <fixture-tenant-id>`.

The SQL check clones schema and fixture rows into connection-local temporary tables, verifies name resolution into the temporary schema, mocks all SMTP/provider calls, and rolls back the transaction. It checks real consent queries, provider invoice IDs, recipient selection, tenant isolation, claims, accepted-send recovery, stale claims and alert deduplication/resolution without writing production customer records.

No migration is required. Deployment is verified by observing a genuine scheduled Cloudflare `onboarding.recovery` record and its new `invoicing.watchdog` result on the deployed commit.
