# Codebase Review

Status: active planning doc
Audience: engineering and product
Reviewed: 2026-06-17

## Purpose

This document records the current engineering assessment of the codebase before further feature development. It is meant to drive prioritization, not just capture observations.

## Review Scope

- application architecture and maintainability
- authentication and operator-only access model
- hosted consent flow
- Mollie webhook and sync paths
- e-Boekhouden invoice and relation integration
- invoice email delivery and retry logic
- operational and compliance-sensitive data handling

## Executive Summary

The codebase is structurally serious: typed, parameterized, and backed by passing `lint`, `typecheck`, tests, and production build checks. The main risks are not obvious broken code.

The current issues are concentrated in three areas:

1. failed-payment handling must become more explicit, customer-notified, and operator-task driven before bigger product work
2. compliance implementation work remains around retention UI, dry-run cleanup, and scoped redaction safeguards
3. future feature work must keep the completed security, module, and test hardening patterns instead of reintroducing secret, metadata, or orchestration risk

Development should continue, but the next feature pass should be combined with targeted hardening so the app does not accumulate risk faster than functionality.

## Status Update

Since this review was first written, the first onboarding hardening pass has been implemented.

Implemented so far:

- redirect notices no longer carry the hosted consent link
- consent tokens are no longer written into audit details
- `payment_links.metadata` no longer duplicates the active consent token
- consent lookup now uses a hashed token with encrypted recovery for the authenticated operator copy flow
- a one-time backfill script now exists to erase legacy plaintext consent tokens after the schema migration
- secret-bearing webhook URLs are no longer written into payment metadata
- newly generated Mollie webhook URLs no longer include a shared secret
- the payment drawer no longer returns or renders the raw Mollie webhook callback URL
- auth now fails closed when `AUTH_SECRET` is missing and is covered by a focused test
- latest consent tokens no longer ride in broad customer overview payloads
- the operator flow now returns to the customer drawer with a copyable hosted link surface
- invoice PDF URLs are now trust-gated before operator display or email use, and attachment fetches now enforce redirect, timeout, and size controls
- invoice attachment outcome is now surfaced in the payment drawer instead of being buried in raw metadata
- helper and test coverage were added for the new consent-link utilities, the narrowed consent scope, the health-route visibility split, and the invoice PDF guardrails
- advanced operators can now open full `/api/health` diagnostics without cron bearer secrets, while public requests still get minimal liveness only
- settings now includes a first-class ops overview with failed webhook replay controls and recent reliability activity
- settings and authenticated `/api/health` now share the same reliability ops snapshot for webhook health, invoice automation, delivery retries, and cron heartbeat
- settings now also surfaces a targeted repair form for single customer, payment, or subscription resyncs
- invoice creation batch handling now has a shared helper and executable coverage for first-payment and recurring batch mapping
- invoice delivery retry batch handling now has a shared helper and executable coverage for first-payment and recurring retry mapping
- payment sync persistence now lives in a shared helper with executable boundary coverage for the sync orchestrator
- subscription sync persistence now lives in a shared helper with executable boundary coverage for the sync orchestrator
- customer billing repair now lives in a dedicated onboarding helper with executable boundary coverage
- retention inventory reporting now exists as a read-only ops command for audit logs, webhook events, and consent evidence
- reconciliation mode labels and follow-up policy now live in a shared helper used by settings and sync flows
- first-payment invoice match CTE and filter logic now live in a shared helper with focused coverage
- first-payment onboarding payment-link and consent record mapping now live in a shared helper with focused coverage
- recurring invoice due and retry filter logic now live in a shared helper with focused coverage
- subscription activation result messaging now lives in a shared helper with focused coverage
- Mollie webhook ingestion now routes through an injectable helper with executable coverage for JSON/form parsing, supported resource checks, pending event storage, processed/failed status updates, and preferred-mode behavior
- consent form acceptance parsing and required-checkbox policy now live in a pure helper with executable coverage
- consent acceptance orchestration now routes through an injectable helper with executable coverage for invalid forms, missing records, missing checkout URLs, already-accepted consent, missing required acknowledgements, and successful acceptance updates
- first-payment onboarding link status, amount fallback, and non-secret metadata mapping now live in a pure helper with executable coverage
- settings reconciliation now exposes explicit `sync_only` versus `full` modes so operators can refresh Mollie state without automatically triggering invoice or activation follow-ups
- the standalone Track A onboarding hardening plan has been retired; the remaining hardening work now lives in the active docs below
- product scope has been narrowed so subscriptions stay inside customer workflows and payment links stay inside onboarding instead of becoming standalone workspaces
- deep technical settings controls are now gated behind advanced/developer/admin-only access with `AUTH_ADVANCED_EMAILS` and hidden behind a developer mode toggle, while normal billing/accounting settings remain available to authenticated operators
- e-Boekhouden relation search no longer hydrates every list result with a detail request; full relation detail is fetched only after the operator selects one relation
- the customer drawer now exposes protected customer-centered billing history for subscriptions, mandates, and payments
- failed-payment outcome classification now starts in a pure helper before side effects, covering recurring failures, first-payment failures, mandate-only setup failures, mandate problems, refunds/reversals, chargebacks, and unsafe long-pending payments
- failed-payment customer notification now uses a typed claim-before-send table and is triggered from reconciled Mollie payment sync rather than raw webhook payloads
- the normal dashboard and notifications surface now share a typed Needs Attention query for failed payment, failed invoice, failed invoice delivery, missing relation, stale sync, missing mandate/setup, subscription payment-action, out-of-sync, and failed-webhook items, with source-scope coverage and no raw webhook payload selection
- derived customer lifecycle state now starts in a pure helper with focused coverage, returning a stable state, reason, and operator-facing explanation before any UI or manual override work
- the customer table and drawer now surface the derived lifecycle state and explanation without adding manual lifecycle override fields
- customer activity timeline reads now start in a server-side query helper with stable item types and source-scope coverage that keeps raw audit details, alert payloads, webhook payloads, and generic metadata out of timeline output
- the customer drawer now loads the sanitized activity timeline through an authenticated customer activity API, keeping raw details, payloads, and metadata out of the normal client surface
- customer notes now have an explicit `customer_notes` table and server query helper with typed source, nonblank body constraint, and migration backfill from the legacy `customers.notes` column
- customer note creation now uses an authenticated customer notes API and writes an audit entry that references the note id without copying note body text into audit details

The rest of this document keeps the original risk assessment, but the consent-token item below should now be read as materially mitigated rather than still open.

## Validation Snapshot

The following checks passed during the review:

- `npm run lint`
- `npm run typecheck`
- `npm run test:node`
- `npm run build`

## Priority Findings

### P1: Consent token handling was too loose; the highest-risk leak paths and the main at-rest exposure are now mitigated

The hosted customer consent token was previously treated too loosely for a bearer-style token. The highest-risk leak paths have now been reduced, the token is no longer selected into broad customer overview payloads, and canonical lookup no longer depends on a plaintext token stored in the consent row.

Observed paths:

- generated in [lib/onboarding/actions.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/onboarding/actions.ts:1124>)
- stored in `subscription_onboarding_consents` in [lib/onboarding/actions.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/onboarding/actions.ts:1219>)
- read by the authenticated consent-link endpoint in [app/api/customer-consent-link/route.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/app/api/customer-consent-link/route.ts:1>) through [lib/onboarding/data.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/onboarding/data.ts:602>)
- hashed/encrypted token storage helper in [lib/onboarding/consent-token-storage.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/onboarding/consent-token-storage.ts:1>)
- surfaced through the customer drawer copy flow in [components/customer-flow-dialogs.tsx](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/components/customer-flow-dialogs.tsx:964>)
- no longer written into audit details in [lib/onboarding/actions.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/onboarding/actions.ts:1227>) through [lib/audit.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/audit.ts:45>)
- no longer pushed into the operator redirect notice query string in [lib/onboarding/actions.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/onboarding/actions.ts:1247>) via [lib/onboarding/consent-link.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/onboarding/consent-link.ts:1>)
- legacy plaintext cleanup script in [scripts/backfill-consent-token-storage.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/scripts/backfill-consent-token-storage.ts:1>)

Why this is unhealthy:

- query-string transport was a real leak path and should stay removed
- audit logs should not persist active customer-facing bearer tokens
- database-only exposure should not reveal active consent links when authenticated operator recovery can use encrypted storage instead
- the broad customer overview path should stay token-free

Recommended direction:

- keep the redirect notice generic and continue using the drawer-based copy flow
- keep the audit redaction in place
- keep token duplication out of generic metadata unless a concrete dependency reappears
- keep latest consent token lookup behind the narrower authenticated endpoint
- keep plaintext `consent_token` as migration-only fallback, not canonical storage
- run the backfill script after deploy so legacy rows stop carrying the raw token

### P1: Invoice PDF delivery path is now constrained to trusted document sources

The app no longer trusts arbitrary invoice document URLs. It now normalizes invoice PDF links to trusted `https://*.e-boekhouden.nl` hosts, keeps untrusted links out of the payment drawer and outgoing emails, and caps attachment fetch redirects, time, and size.

Observed paths:

- metadata URL extraction in [app/api/payments/mollie/route.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/app/api/payments/mollie/route.ts:70>)
- payment drawer URL resolution in [app/api/payments/mollie/route.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/app/api/payments/mollie/route.ts:91>)
- delivery-time URL resolution in [lib/invoice-delivery.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/invoice-delivery.ts:139>)
- direct fetch in [lib/invoice-delivery.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/invoice-delivery.ts:169>)

Why this was unhealthy:

- no allowlist for expected hosts
- no timeout enforcement
- no content-type validation
- no content-length or byte-size cap
- metadata poisoning can become SSRF or memory-pressure behavior

Recommended direction:

- keep allowing only trusted e-Boekhouden-origin document hosts
- keep fetch timeout and maximum response size enforcement in place
- keep treating metadata URLs as hints, not truth
- keep the payment-drawer attachment status visible for operator debugging
- expose the same attachment/source status in broader ops surfaces only if it becomes operationally necessary

### P1: Webhook callback URLs are now secret-free and constrained by managed-resource checks

New Mollie webhook callback URLs no longer append the shared secret. Webhook intake treats the request as an untrusted signal, stores the event, re-fetches current Mollie state, and only processes resources that resolve back to managed local app state.

Observed paths:

- webhook URL builder in [lib/mollie/client.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/mollie/client.ts:40>)
- request validation in [app/api/webhooks/mollie/route.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/app/api/webhooks/mollie/route.ts:88>)
- onboarding use in [lib/onboarding/actions.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/onboarding/actions.ts:1125>)
- the previous persistence path into payment metadata has been removed in [lib/reliability/sync.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/reliability/sync.ts>)
- raw webhook URL display is now replaced by non-secret status in [app/api/payments/mollie/route.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/app/api/payments/mollie/route.ts:211>) and [components/payment-drawer.tsx](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/components/payment-drawer.tsx:731>)

Why the previous design was unhealthy:

- secrets in URLs are easy to leak through logs and operational tooling
- the secret existed in process memory while outbound Mollie calls were assembled
- any future metadata reintroduction would recreate a leak path

Recommended direction:

- keep generated webhook URLs secret-free
- keep the secret out of persisted metadata
- keep the secret out of client-visible operator payloads
- keep webhook processing tied to managed local resources
- rely on scheduled reconciliation and repair for missed or rejected webhook signals

### P2: `/api/health` now splits public liveness from advanced diagnostics

The health route now returns a minimal public liveness response by default, while the detailed reliability snapshot requires the cron bearer secret.

Observed path:

- [app/api/health/route.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/app/api/health/route.ts:21>)

Returned data includes:

- setup readiness
- database connectivity
- live/test configuration presence
- open and unresolved alert counts
- failed webhook counts
- invoice queue state
- cron heartbeat history

Why this was unhealthy:

- it gives unauthenticated observers a clean map of internal operations
- it is more than a basic liveness endpoint
- the data is useful for attackers and not required publicly

Recommended direction:

- keep the public response minimal
- keep the detailed reliability snapshot behind cron auth or advanced operator auth
- keep the settings ops surface aligned with the same diagnostics so operators do not need to rely on raw JSON or CLI first

### P2: Auth now fails closed on missing-secret misconfiguration

Authentication now throws if `AUTH_SECRET` is absent.

Observed path:

- [auth.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/auth.ts:10>)

Why this is unhealthy:

- this item is now mitigated in code
- keep the setup check aligned with runtime auth behavior

Recommended direction:

- keep `AUTH_SECRET` required in every deployed environment
- fail setup early rather than relying on a fallback secret

### P2: Core business logic is too concentrated

The most important workflows are packed into a few large files:

- [lib/onboarding/actions.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/onboarding/actions.ts>)
- [lib/reliability/sync.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/reliability/sync.ts>)
- [lib/eboekhouden/first-payment-invoices.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/eboekhouden/first-payment-invoices.ts>)
- [lib/eboekhouden/recurring-invoices.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/eboekhouden/recurring-invoices.ts>)

Why this is unhealthy:

- change risk is high because each file owns too many concerns
- reading and reviewing becomes slow
- regression scope is larger than necessary for small feature changes

Recommended direction:

- split orchestration from pure domain helpers
- isolate side effects from state-transition logic
- create narrower modules around consent, payment-link creation, payment sync, invoice claiming, and alert generation

Progress:

- first-payment plan normalization, term validation, and consent-plan construction now live in [lib/onboarding/first-payment-plan.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/onboarding/first-payment-plan.ts>) with focused node coverage
- onboarding action redirect path mutation now lives in [lib/onboarding/action-path.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/onboarding/action-path.ts>) with focused node coverage
- onboarding action redirect, serialization, and relation-availability helpers now live in [lib/onboarding/action-helpers.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/onboarding/action-helpers.ts>) with focused node coverage
- first-payment duplicate/create-blocker policy now lives in [lib/onboarding/first-payment-blocker.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/onboarding/first-payment-blocker.ts>) with focused node coverage
- customer archive/restore decision policy now lives in [lib/onboarding/customer-archive-policy.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/onboarding/customer-archive-policy.ts>) with focused node coverage
- customer archive/restore state-change orchestration now lives in [lib/onboarding/customer-archive-flow.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/onboarding/customer-archive-flow.ts>) with focused node coverage
- customer create/import orchestration now lives in [lib/onboarding/customer-creation-flow.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/onboarding/customer-creation-flow.ts>) with focused node coverage
- customer relation-link orchestration now lives in [lib/onboarding/customer-relation-link-flow.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/onboarding/customer-relation-link-flow.ts>) with focused node coverage
- payment-link sync status, amount fallback, and metadata mapping now live in [lib/reliability/payment-link-sync-record.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/reliability/payment-link-sync-record.ts>) with focused node coverage
- payment sync classification, chargeback detection, review timestamping, and metadata mapping now live in [lib/reliability/payment-sync-record.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/reliability/payment-sync-record.ts>) with focused node coverage
- payment and subscription alert side effects now live in [lib/reliability/sync-alerts.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/reliability/sync-alerts.ts>) so sync orchestration no longer owns alert delivery details
- subscription sync handlers now live in [lib/reliability/subscription-sync-operations.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/reliability/subscription-sync-operations.ts>) and the row-persistence seam stays isolated in [lib/reliability/subscription-sync-persistence.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/reliability/subscription-sync-persistence.ts>) with focused node coverage
- Mollie mode fallback and strict-mode selection now live in [lib/reliability/mollie-mode-selection.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/reliability/mollie-mode-selection.ts>) with focused node coverage
- Mollie resource lookup retry/fallback orchestration now lives in [lib/reliability/mollie-resource-lookup.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/reliability/mollie-resource-lookup.ts>) with focused node coverage
- reconciliation mode policy now lives in [lib/reliability/reconciliation-mode.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/reliability/reconciliation-mode.ts>) with focused node coverage
- first-payment invoice match query construction now lives in [lib/eboekhouden/first-payment-invoice-match-query.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/eboekhouden/first-payment-invoice-match-query.ts>) with focused node coverage
- first-payment invoice candidate lookup now lives in [lib/eboekhouden/first-payment-invoice-candidate.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/eboekhouden/first-payment-invoice-candidate.ts>) with focused node coverage
- first-payment invoice creation workflow now lives in [lib/eboekhouden/first-payment-invoice-workflow.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/eboekhouden/first-payment-invoice-workflow.ts>) with focused node coverage
- first-payment invoice retry queue and retry summary logic now live in [lib/eboekhouden/first-payment-invoice-retry.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/eboekhouden/first-payment-invoice-retry.ts>) with focused node coverage
- first-payment onboarding record mapping now lives in [lib/onboarding/first-payment-onboarding-records.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/onboarding/first-payment-onboarding-records.ts>) with focused node coverage
- first-payment onboarding workflow orchestration now lives in [lib/onboarding/first-payment-onboarding-flow.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/onboarding/first-payment-onboarding-flow.ts>) with focused node coverage
- first-payment action guard and kickoff orchestration now live in [lib/onboarding/first-payment-action-flow.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/onboarding/first-payment-action-flow.ts>) with focused node coverage
- recurring invoice query filtering now lives in [lib/eboekhouden/recurring-invoice-query.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/eboekhouden/recurring-invoice-query.ts>) with focused node coverage
- recurring invoice candidate lookup now lives in [lib/eboekhouden/recurring-invoice-candidate.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/eboekhouden/recurring-invoice-candidate.ts>) with focused node coverage
- subscription activation result messaging now lives in [lib/onboarding/subscription-activation-result.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/onboarding/subscription-activation-result.ts>) with focused node coverage
- first-payment invoice eligibility policy now lives in [lib/eboekhouden/first-payment-invoice-eligibility.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/eboekhouden/first-payment-invoice-eligibility.ts>) with focused node coverage
- first-payment invoice date resolution now lives in [lib/eboekhouden/first-payment-invoice-date.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/eboekhouden/first-payment-invoice-date.ts>) with focused node coverage
- first-payment invoice delivery payload mapping now lives in [lib/eboekhouden/first-payment-invoice-delivery.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/eboekhouden/first-payment-invoice-delivery.ts>) with focused node coverage
- first-payment invoice claim/success/failure persistence now lives in [lib/eboekhouden/first-payment-invoice-persistence.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/eboekhouden/first-payment-invoice-persistence.ts>) with focused node coverage
- first-payment invoice queue/state normalization now lives in [lib/eboekhouden/first-payment-invoice-queue.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/eboekhouden/first-payment-invoice-queue.ts>) with focused node coverage
- first-payment failed-row recovery now lives in [lib/eboekhouden/first-payment-invoice-recovery.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/eboekhouden/first-payment-invoice-recovery.ts>) with focused node coverage
- first-payment invoice auto-create follow-up handling now lives in [lib/reliability/first-payment-invoice-followup.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/reliability/first-payment-invoice-followup.ts>) with focused node coverage
- first-payment invoice sync follow-up handling now lives in [lib/reliability/first-payment-sync-followup.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/reliability/first-payment-sync-followup.ts>) with focused node coverage
- reconciliation operations orchestration now lives in [lib/reliability/reconciliation-operations.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/reliability/reconciliation-operations.ts>) with focused node coverage
- recurring invoice creation workflow now lives in [lib/eboekhouden/recurring-invoice-workflow.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/eboekhouden/recurring-invoice-workflow.ts>) with focused node coverage
- recurring invoice creation persistence now lives in [lib/eboekhouden/recurring-invoice-persistence.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/eboekhouden/recurring-invoice-persistence.ts>) with focused node coverage
- recurring failed-row recovery now lives in [lib/eboekhouden/recurring-invoice-recovery.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/eboekhouden/recurring-invoice-recovery.ts>) with focused node coverage
- recurring invoice retry queue and retry summary logic now live in [lib/eboekhouden/recurring-invoice-retry.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/eboekhouden/recurring-invoice-retry.ts>) with focused node coverage
- recurring failed-row recovery now has a dedicated module-boundary test so the main recurring invoice file stays orchestration-only
- sync resource lookup and mandate upsert helpers now live in [lib/reliability/sync-resource-state.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/reliability/sync-resource-state.ts>) with focused node coverage
- payment-link sync orchestration now lives in [lib/reliability/payment-link-sync.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/reliability/payment-link-sync.ts>) with focused node coverage
- Mollie payment/subscription lookup wrappers now live in [lib/reliability/sync-mollie-lookups.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/reliability/sync-mollie-lookups.ts>) with focused node coverage
- operations action redirect and serialization helpers now live in [lib/operations/action-helpers.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/operations/action-helpers.ts>) with focused node coverage
- subscription sync billing-day, terminal-state, and metadata mapping now live in [lib/reliability/subscription-sync-record.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/reliability/subscription-sync-record.ts>) with focused node coverage
- first-payment and recurring invoice modules now share count, amount, error, date, and duplicate-reference helpers in [lib/eboekhouden/invoice-flow-helpers.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/eboekhouden/invoice-flow-helpers.ts>) with focused node coverage
- first-payment and recurring invoice creation claim/success/failure metadata now share [lib/eboekhouden/invoice-creation-metadata.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/eboekhouden/invoice-creation-metadata.ts>) with focused node coverage
- first-payment and recurring invoice retry metadata now share [lib/eboekhouden/invoice-retry-metadata.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/eboekhouden/invoice-retry-metadata.ts>) with focused node coverage
- first-payment and recurring safe retry candidate filtering now share [lib/eboekhouden/invoice-retry-candidates.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/eboekhouden/invoice-retry-candidates.ts>) with focused node coverage
- customer onboarding relation-field normalization and e-Boekhouden patch detection now live in [lib/onboarding/customer-relation-fields.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/onboarding/customer-relation-fields.ts>) with focused node coverage

### P2: Highest-risk flows now have focused seam coverage; broader DB-backed integration remains optional hardening

Existing tests now cover the main money/compliance flow decisions at pure or dependency-injected seams, but they still stop short of a full database-backed end-to-end harness.

Observed test surface:

- [package.json](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/package.json:23>)
- current test files are concentrated in small helper modules, not the end-to-end flows

Why this still matters:

- onboarding, webhook processing, sync repair, and invoice creation are where money and compliance risk live
- the current tests lock the critical decisions, but full route/action/database integration would catch wiring issues that seam tests cannot

Recommended direction:

- keep adding focused integration-style tests when touching these paths
- consider a database-backed test harness only if future changes increase cross-table behavior or regression cost

Webhook ingestion/status handling now has executable coverage around the route helper; replay behavior remains partially covered by source-scope tests.
Consent form parsing, required-checkbox policy, and acceptance orchestration now have executable coverage around injected dependencies.
First-payment setup plan normalization and fixed-term validation now have executable coverage before Mollie side effects.

### P3: e-Boekhouden relation search fan-out is now reduced

One search request previously fanned out into several upstream requests and then hydrated each returned relation with a detail request. The list route now returns lightweight list rows and leaves full detail hydration to the existing per-relation selection endpoint.

Observed paths:

- search fan-out in [lib/eboekhouden/client.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/eboekhouden/client.ts:287>)
- per-item hydration in [app/api/eboekhouden/relations/route.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/app/api/eboekhouden/relations/route.ts:47>)

Why this still matters:

- the search API still fans out across name, contact, email, and code when the operator enters a query
- detail hydration is now bounded to one selected relation instead of every list row

Recommended direction:

- keep full relation detail loading on the `/api/eboekhouden/relations/[id]` path
- only revisit query fan-out if upstream rate limits become a real operational problem

## Maintainability Notes

What is good:

- widespread Zod validation on server actions and routes
- SQL is parameterized rather than string-built
- strong preference for local persistence before and after external sync
- explicit mode separation for Mollie `test` and `live`
- durable audit and alert model gives operators recovery tools

What is still rough:

- JSONB metadata is doing too much work as an informal secondary schema
- secret-bearing or compliance-sensitive fields are mixed into generic metadata blobs
- orchestration code and policy code are too close together in large modules

Dependency posture:

- prefer well-maintained packages for generic hard problems when they reduce risk, complexity, or maintenance cost
- keep product-specific billing, consent, reconciliation, retry, and accounting policy explicit in local code
- avoid adding dependencies just to hide domain decisions or small one-off helpers

## Compliance And Legal Watchlist

This is not legal advice. It is the engineering-side compliance watchlist for the current implementation.

### GDPR / Dutch AVG

Relevant processing in this app includes:

- customer identity and contact data
- payment and subscription state
- consent evidence
- IP addresses and user agents
- operator audit logs

Observed persistence points:

- consent IP and user agent in [lib/subscription-consent.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/subscription-consent.ts:281>) and [db/schema.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/db/schema.ts:698>)
- audit logs in [db/schema.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/db/schema.ts:803>)
- webhook event payload history in [db/schema.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/db/schema.ts:835>)

Current state:

- retention windows and minimization rules are now decided in `documentation/operations/retention-compliance-runbook.md`
- read-only inventory tooling exists
- cleanup implementation should proceed as dry-run first, then explicit scoped apply

Operational implication:

- storage limitation and data minimization now need implementation, not further policy selection

Official references:

- [GDPR Articles 5, 25, 28, 32](https://eur-lex.europa.eu/legal-content/EN/TXT/?qid=1497261922341&uri=CELEX%3A32016R0679)
- [Business.gov.nl: protection of personal data](https://business.gov.nl/regulations/protection-personal-data/)
- [Business.gov.nl: drafting a privacy statement](https://business.gov.nl/regulation/draw-up-privacy-statement/)

### Data Breach Readiness

Current implication:

- because the app stores financial and personal data, a breach process is required and should be tied to logging, alerting, and incident response

Official reference:

- [Business.gov.nl: preventing and reporting a data breach](https://business.gov.nl/running-your-business/security-and-fraud/data-breach/)

### Invoice Retention / Tax Administration

Current implication:

- invoice storage and exported invoice evidence should respect Dutch retention obligations
- deleting or mutating invoice-linked data needs a stricter operational policy than ordinary app cleanup

Official references:

- [Belastingdienst: invoice retention](https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/btw/administratie_bijhouden/facturen_maken/uw_facturen_bewaren)
- [Belastingdienst: invoice timing and administration](https://www.belastingdienst.nl/efactuur)

### SEPA Pre-notification

Current implication:

- the app uses a 5-day invoice pre-notification policy and stores that the debtor agreed to a shorter timeline
- this is acceptable only if the legal and consent wording really supports that shorter agreement in every relevant flow

Relevant implementation:

- [lib/recurring-billing-policy.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/recurring-billing-policy.ts:4>)
- [lib/recurring-billing-policy.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/recurring-billing-policy.ts:55>)

Official reference:

- [European Payments Council SEPA direct debit rulebook](https://www.europeanpaymentscouncil.eu/sites/default/files/kb/file/2025-10/EPC222-07%202025%20SDD%20B2B%20Rulebook%20version%201.1.pdf)

## Remediation Tracks

These tracks are designed so hardening work can also improve feature work instead of purely slowing development down.

### Completed: Secure Document And Invoice Delivery Path

Goals:

- harden invoice document fetch behavior
- keep invoice delivery reliable without trusting arbitrary URLs

Feature overlap:

- clearer invoice-state deltas
- unified reliability and invoice automation visibility

Suggested work:

- add trusted-host validation and size/time limits for PDF fetches
- record structured delivery failure causes
- expose attachment/source status more clearly in payments and settings UI

Status:

- trusted-host validation and size/time limits are implemented
- invoice creation and delivery retry batch helpers now have executable coverage
- attachment/source status is visible where operators already inspect payments

### Completed: Ops Surface Hardening

Goals:

- reduce secret exposure
- separate public health from advanced operator diagnostics
- make repair and replay tools safer to expose in UI

Feature overlap:

- unified ops screen
- safer webhook replay and repair controls
- explicit reconciliation modes

Suggested work:

- split `/api/health` into liveness and advanced/cron diagnostics
- stop persisting secret-bearing webhook URLs into metadata
- review cron and repair endpoints for least-privilege exposure
- expose explicit reconciliation modes so operator-triggered refresh does not imply full downstream billing side effects

Status:

- `/api/health` now separates public liveness from advanced/cron diagnostics
- webhook URLs are secret-free and no longer persisted into generic metadata
- settings exposes failed-only webhook replay, targeted repair, and explicit reconciliation modes
- the deep technical settings surface is gated behind `AUTH_ADVANCED_EMAILS` and collapsed behind developer mode; billing/accounting configuration remains outside that advanced gate

### Completed: Module And Test Refactor

Goals:

- lower change risk on core billing paths
- make future feature delivery faster and safer

Feature overlap:

- basically every planned billing/reliability feature

Status:

- core onboarding and invoice flows now route through dedicated policy, workflow, retry, persistence, and recovery modules with focused seam coverage
- `lib/onboarding/actions.ts` has been reduced to mostly thin server-action wrappers
- `lib/reliability/sync.ts` and `lib/eboekhouden/recurring-invoices.ts` remain as accepted orchestration wrappers rather than priority refactor targets
- future changes should only reopen this track if those wrapper modules start re-accumulating mixed policy/persistence/third-party logic

### Active: Retention And Compliance Implementation

Goals:

- implement accepted retention windows and minimization rules
- keep cleanup tooling report-only and dry-run first
- avoid broad purge defaults that could destroy audit or compliance evidence too early

Feature overlap:

- ops visibility into stale data and cleanup candidates
- safer, explicit lifecycle management for logs, webhook history, and consent evidence

Suggested work:

- keep the read-only retention inventory command
- add a policy display surface from the accepted baseline
- add dry-run cleanup and scoped redaction reports
- only then add explicit, scoped apply behavior

Status:

- the read-only retention inventory command now exists as `npm run ops:retention-report`
- retention policy decisions are documented and no longer block implementation
- destructive cleanup is intentionally not implemented yet
- dry-run cleanup and redaction tooling are the next safe implementation step

## Recommended Current Order

If the goal is best risk reduction with the least wasted effort, start in this order:

1. Failed payment correctness
2. Needs attention dashboard
3. Retention policy UI and dry-run cleanup

Reasoning:

- money flow correctness should lead larger feature work
- failed payments must be detected, explained, customer-notified, and surfaced as operator tasks before pause/cancel/dunning consequences are automated
- the broad product-surface questions are now intentionally resolved around the customer workspace
- the highest-value module-and-test refactor work has already been completed enough to stop being the lead track
- retention policy is decided; destructive cleanup still waits for dry-run output and explicit scoped safeguards

## Planning Rule

Before shipping the next major feature pass, any work that touches onboarding, payments, webhooks, repair, or invoice delivery should be required to leave the touched path:

- at least as secure as before
- at least as testable as before
- with fewer secret-bearing values in URLs, logs, and metadata than before
- aligned with `documentation/product/implementation-roadmap.md`
