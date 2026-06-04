# Codebase Review

Status: active planning doc
Audience: engineering and product
Reviewed: 2026-06-04

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

1. security hygiene around secrets, bearer-style tokens, and server-side fetches
2. oversized business-logic modules with limited test coverage on the highest-risk flows
3. compliance gaps around retention, privacy boundaries, and public operational exposure

Development should continue, but the next feature pass should be combined with targeted hardening so the app does not accumulate risk faster than functionality.

## Status Update

Since this review was first written, the first onboarding hardening pass has been implemented.

Implemented so far:

- redirect notices no longer carry the hosted consent link
- consent tokens are no longer written into audit details
- `payment_links.metadata` no longer duplicates the active consent token
- secret-bearing webhook URLs are no longer written into payment metadata
- auth now fails closed when `AUTH_SECRET` is missing
- the operator flow now returns to the customer drawer with a copyable hosted link surface
- helper and test coverage were added for the new consent-link utilities

The rest of this document keeps the original risk assessment, but the consent-token item below should now be read as partially mitigated rather than fully open.

## Validation Snapshot

The following checks passed during the review:

- `npm run lint`
- `npm run typecheck`
- `npm run test:node`
- `npm run build`

## Priority Findings

### P1: Consent token handling was too loose; the highest-risk leak paths are now mitigated

The hosted customer consent token was previously treated too loosely for a bearer-style token. The highest-risk leak paths have now been reduced, but the canonical token still exists in dedicated storage and is still used to derive operator-facing consent links.

Observed paths:

- generated in [lib/onboarding/actions.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/onboarding/actions.ts:1124>)
- stored in `subscription_onboarding_consents` in [lib/onboarding/actions.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/onboarding/actions.ts:1219>)
- derived into operator-facing UI data in [lib/ui-data.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/ui-data.ts:125>)
- surfaced through the customer drawer copy flow in [components/customer-flow-dialogs.tsx](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/components/customer-flow-dialogs.tsx:964>)
- no longer written into audit details in [lib/onboarding/actions.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/onboarding/actions.ts:1227>) through [lib/audit.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/audit.ts:45>)
- no longer pushed into the operator redirect notice query string in [lib/onboarding/actions.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/onboarding/actions.ts:1247>) via [lib/onboarding/consent-link.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/onboarding/consent-link.ts:1>)

Why this is unhealthy:

- query-string transport was a real leak path and should stay removed
- audit logs should not persist active customer-facing bearer tokens
- the remaining token exposure should stay constrained to the canonical consent table and intentionally derived operator UI

Recommended direction:

- keep the redirect notice generic and continue using the drawer-based copy flow
- keep the audit redaction in place
- keep token duplication out of generic metadata unless a concrete dependency reappears
- review whether `latestConsentToken` should remain in broad customer overview data or move behind a narrower operator-only fetch path
- consider storing only a hashed lookup token if the flow can support it

### P1: Invoice PDF delivery path allows unsafe server-side fetches

The app resolves invoice document URLs from mutable metadata and then fetches them server-side for email attachments.

Observed paths:

- metadata URL extraction in [app/api/payments/mollie/route.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/app/api/payments/mollie/route.ts:70>)
- payment drawer URL resolution in [app/api/payments/mollie/route.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/app/api/payments/mollie/route.ts:91>)
- delivery-time URL resolution in [lib/invoice-delivery.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/invoice-delivery.ts:139>)
- direct fetch in [lib/invoice-delivery.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/invoice-delivery.ts:169>)

Why this is unhealthy:

- no allowlist for expected hosts
- no timeout enforcement
- no content-type validation
- no content-length or byte-size cap
- metadata poisoning can become SSRF or memory-pressure behavior

Recommended direction:

- allow only trusted e-Boekhouden-origin document hosts
- enforce fetch timeout and maximum response size
- require PDF content type before attachment
- treat metadata URLs as hints, not truth

### P1: Webhook secret is still embedded in outbound URLs, but the metadata leak path is gone

The shared webhook secret is appended as a query parameter for Mollie webhook calls. The previous persistence path into generic metadata has been removed.

Observed paths:

- webhook URL builder in [lib/mollie/client.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/mollie/client.ts:40>)
- request validation in [app/api/webhooks/mollie/route.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/app/api/webhooks/mollie/route.ts:88>)
- onboarding use in [lib/onboarding/actions.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/onboarding/actions.ts:1125>)
- the previous persistence path into payment metadata has been removed in [lib/reliability/sync.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/reliability/sync.ts>)

Why this is unhealthy:

- secrets in URLs are easy to leak through logs and operational tooling
- the secret still exists in process memory while outbound Mollie calls are assembled
- any future metadata reintroduction would recreate a leak path

Recommended direction:

- keep the secret out of persisted metadata
- minimize where the fully signed webhook URL exists in process memory and logs
- reassess whether the webhook verification model can be made less leak-prone

### P2: Public `/api/health` exposes internal operating state

The health route has no access control and returns internal readiness and reliability state.

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

Why this is unhealthy:

- it gives unauthenticated observers a clean map of internal operations
- it is more than a basic liveness endpoint
- the data is useful for attackers and not required publicly

Recommended direction:

- split into public liveness and authenticated operator diagnostics
- keep the detailed reliability snapshot behind operator auth or cron auth

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

### P2: Highest-risk flows are weakly tested

Existing tests are mostly helper or formatter level.

Observed test surface:

- [package.json](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/package.json:23>)
- current test files are concentrated in small helper modules, not the end-to-end flows

Why this is unhealthy:

- onboarding, webhook processing, sync repair, and invoice creation are where money and compliance risk live
- those flows currently depend more on careful reading than executable guarantees

Recommended direction:

- add focused integration-style tests around:
  - consent acceptance and token handling
  - webhook ingestion and replay
  - first-payment sync -> invoice create
  - recurring invoice create/delivery retry
  - repair flows with mixed happy and failure paths

### P3: e-Boekhouden relation search is operationally expensive

One search request can fan out into several upstream requests.

Observed paths:

- search fan-out in [lib/eboekhouden/client.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/eboekhouden/client.ts:287>)
- per-item hydration in [app/api/eboekhouden/relations/route.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/app/api/eboekhouden/relations/route.ts:47>)

Why this is unhealthy:

- unnecessary latency under search-heavy operator sessions
- greater chance of rate-limit pain upstream

Recommended direction:

- reduce detail hydration during search
- fetch full relation detail only when the operator drills into one item

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

Current gap:

- no clear retention/purge policy was found for audit logs, webhook events, consent evidence minimization, or metadata cleanup

Operational implication:

- storage limitation and data minimization need explicit policy and implementation, not just documentation

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

### Track A: Secure Onboarding And Consent Flow

Goals:

- remove token leakage
- tighten consent evidence handling
- improve operator UX for share/retry flows

Feature overlap:

- safer, clearer operator controls for onboarding and repair
- future reconciliation and customer-workflow improvements

Suggested work:

- remove share-link query-string notices
- add explicit operator copy/share affordance in customer UI
- redact consent tokens from audit details and generic metadata
- define retention rules for consent evidence fields

### Track B: Secure Document And Invoice Delivery Path

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

### Track C: Ops Surface Hardening

Goals:

- reduce secret exposure
- separate public health from operator diagnostics
- make repair and replay tools safer to expose in UI

Feature overlap:

- unified ops screen
- safer webhook replay and repair controls
- explicit reconciliation modes

Suggested work:

- split `/api/health` into liveness and authenticated diagnostics
- stop persisting secret-bearing webhook URLs into metadata
- review cron and repair endpoints for least-privilege exposure

### Track D: Module And Test Refactor

Goals:

- lower change risk on core billing paths
- make future feature delivery faster and safer

Feature overlap:

- basically every planned billing/reliability feature

Suggested work:

- extract pure decision helpers from large orchestration files
- add integration tests for onboarding, webhook sync, invoice creation, and delivery retry
- reduce JSONB metadata dependence where fields deserve first-class schema columns

## Recommended Starting Order

If the goal is best risk reduction with the least wasted effort, start in this order:

1. Track A: secure onboarding and consent flow
2. Track C: ops surface hardening
3. Track B: invoice delivery hardening
4. Track D: modularization and deeper tests

Reasoning:

- Track A removes the clearest bearer-token issue and improves a customer-facing feature path
- Track C reduces avoidable exposure while directly helping the planned unified ops work
- Track B closes the biggest server-side fetch risk in money-adjacent flows
- Track D is important, but should be shaped by the safer boundaries created by A-C

## Planning Rule

Before shipping the next major feature pass, any work that touches onboarding, payments, webhooks, repair, or invoice delivery should be required to leave the touched path:

- at least as secure as before
- at least as testable as before
- with fewer secret-bearing values in URLs, logs, and metadata than before
