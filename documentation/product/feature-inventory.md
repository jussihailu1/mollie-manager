# Feature Inventory

Status: active planning doc
Audience: product and engineering

Use this file as the working inventory for ongoing development.

Canonical policy docs:

- `subscription-policy.md`
- `recurring-billing-policy.md`
- `subscription-roadmap.md`

## Implemented

- [x] Google sign-in with a single allowed operator email
- [x] test/live Mollie mode selection with cookie-backed operator mode
- [x] dashboard, customers, payments, notifications, and settings surfaces
- [x] customer creation with richer contact and metadata fields
- [x] e-Boekhouden relation import and linking flows
- [x] first-payment onboarding with hosted consent flow before Mollie checkout
- [x] first-payment mode selection: `real_installment` or `mandate_only`
- [x] fixed-term subscription support with `subscription_term_mode`, `total_payments`, `service_end_at`, and `cancellation_effect`
- [x] recurring billing notice and consent capture aligned with the current policy docs
- [x] Mollie sync for customers, mandates, payments, payment links, and subscriptions
- [x] webhook event storage before processing
- [x] reconciliation and repair actions
- [x] durable alerts and audit logs
- [x] recurring invoice creation through e-Boekhouden
- [x] first-payment invoice creation through e-Boekhouden
- [x] app-owned invoice email delivery with override mailbox support
- [x] protected cron flow for repair, recovery, invoice creation, and delivery retries
- [x] operational readiness, backlog, gate, and self-heal scripts

## Partially Implemented Or Narrow In UI

- [x] Subscription management intentionally lives inside customer workflows rather than a dedicated primary workspace
  Status: a customer is the operator's primary subscription context for this product, so a separate subscription screen is not planned.
- [x] Payment-link functionality intentionally lives inside customer onboarding rather than a dedicated primary workspace
  Status: payment links are onboarding artifacts, not a separate operator management object.
- [x] Legacy `/alerts` and `/payment-links` routes are compatibility redirects, not active standalone modules
  Status: this is intentional while notifications/settings and customer onboarding remain the real operator surfaces.
- [x] Manual webhook replay and targeted repair are surfaced in the settings ops workflow
  Status: the settings ops surface now exposes a failed-webhook replay queue with failed-only replay controls and explicit replay confirmation, plus a targeted repair form for single customer/payment/subscription resyncs.
- [x] Reliability and invoice automation health is unified across `/settings` and authenticated `/api/health`
  Status: both surfaces now share the same reliability ops snapshot for webhook health, invoice automation, delivery retries, and cron heartbeat; CLI scripts still remain as deeper fallbacks.
- [x] Deep technical operations controls can remain in settings during developer-operated use
  Status: this is acceptable while the developer is the operator. Before deploying the product as a service for other users, these controls should move behind an advanced/developer/admin-only surface or equivalent protected access.
- [x] Detailed subscription, mandate, and payment history is surfaced in dense customer-centered operator views
  Status: the customer drawer now lazy-loads protected billing history and shows compact subscription, mandate, and payment rows without adding standalone subscription or payment-link workspaces.

## Planned Next

- [x] Add explicit reconciliation modes so operators can choose `sync-only` versus flows that may trigger invoice-side actions
  Status: `/settings` now exposes explicit `sync_only` and `full` reconciliation modes. `sync_only` is the least-dangerous default and avoids automatic first-payment invoice creation and subscription activation follow-ups.
- [x] Expand reconciliation output with first-payment and recurring invoice-state deltas for easier operator review
  Status: `/settings` now shows the latest reconciliation result with before/after invoice-state deltas for first-payment rows and recurring billing schedules, so operators can confirm normalization and invoice-side changes without digging through raw tables.
- [x] Unify stale-sync, webhook-health, and invoice-automation observability into a clearer operator surface
  Status: `/settings` now uses the shared reliability ops snapshot for webhook health, stale repair context, invoice automation, delivery retries, and cron heartbeat; authenticated `/api/health` uses the same source.
- [x] Expose safer, clearer operator controls for webhook replay and repair flows
  Status: the settings page now includes explicit replay confirmation for failed webhook events and a targeted repair form for customer/payment/subscription resyncs.
- [x] Decide whether subscriptions need a dedicated operations workspace again or should stay embedded in customer workflows
  Status: subscriptions stay embedded in customer workflows unless future usage shows a concrete operator need for a separate workspace.

## Cross-Cutting Hardening Work

Reference: `../development/codebase-review.md`

- [x] Remove consent-token leakage from redirect notices, audit logs, and non-essential metadata while improving the operator share-link workflow
  Status: the hashed lookup-token follow-up is implemented. Canonical lookup uses a hash, operator link regeneration uses encrypted recovery, and a one-time backfill script removes legacy plaintext rows after the schema migration.
- [x] Split public health/liveness from authenticated operator diagnostics and reduce operational detail exposed anonymously
  Status: `/api/health` now returns minimal public liveness by default, while full diagnostics are available to cron bearer auth and authenticated operators; `/settings` now surfaces a clearer operator view over the same reliability signals.
- [x] Stop persisting secret-bearing webhook URLs into generic metadata and reduce secret sprawl
  Status: the metadata persistence path is gone, the payment drawer no longer exposes raw callback URLs, and newly generated Mollie webhook URLs are secret-free; webhook processing now requires managed local resource resolution.
- [x] Harden invoice PDF fetch and attachment handling with trusted-host, timeout, and size controls
  Status: trusted e-Boekhouden-only URL handling, redirect/timeout/size controls, and payment-drawer attachment status are now in place; the remaining work is broader ops-surface visibility only if it proves necessary.
- [x] Add integration coverage for consent, webhook sync, first-payment invoice creation, recurring invoice delivery retry, and repair flows
  Status: focused executable coverage now exists at the key flow seams: consent acceptance parsing and injected acceptance orchestration, webhook ingestion/status handling, invoice creation batch mapping, invoice delivery retry batch mapping, and targeted repair routing. A heavier DB-backed end-to-end harness remains optional future hardening rather than a current blocker.
- [ ] Refactor oversized billing/orchestration modules into smaller policy, state-transition, and integration units
  Status: started. Extracted shared invoice creation and delivery retry batch helpers, shared invoice flow helpers, invoice creation metadata, invoice retry metadata, invoice retry candidate filtering, payment sync persistence, subscription sync persistence, customer billing repair, webhook ingestion processing, consent acceptance helpers, customer relation field mapping, customer archive policy, onboarding redirect path helpers, onboarding action redirect/serialization/relation checks, operations action redirect/serialization helpers, first-payment duplicate-blocker policy, first-payment plan policy, first-payment link record mapping, first-payment onboarding record mapping, first-payment onboarding workflow orchestration, first-payment invoice eligibility policy, first-payment invoice date resolution, first-payment invoice candidate lookup, first-payment invoice creation workflow, first-payment invoice delivery payload mapping, first-payment invoice claim/success/failure persistence, first-payment invoice queue/state normalization, first-payment failed-row recovery, first-payment invoice auto-create follow-up handling, first-payment invoice sync follow-up handling, recurring invoice creation workflow, recurring invoice creation persistence, recurring failed-row recovery, recurring failed-row recovery boundary helper, recurring invoice candidate lookup, sync resource state lookup and mandate upsert helpers, payment-link sync operations, Mollie lookup wrappers, reconciliation operations orchestration, payment-link sync record mapping, payment sync classification/metadata mapping, Mollie mode selection, Mollie resource lookup, subscription sync record mapping, subscription sync operations, sync alert handling, and the subscription row-persistence boundary test; biggest remaining orchestration files are now primarily `lib/onboarding/actions.ts`, `lib/reliability/sync.ts`, and narrower recurring/first-payment batch wrappers.

## Deferred Or Later

- [ ] per-subscription policy overrides
- [ ] customer self-serve cancellation
- [ ] richer entitlement rules separate from billing state
- [ ] automated dunning, collection fees, or legal collections flows
- [ ] broader multi-tenant SaaS policy management

## Constraints And Notes

- Mollie stays the payment source of truth.
- e-Boekhouden stays the invoice and accounting source of truth.
- `mandate_only` EUR 0.01 flows must not create normal subscription invoices.
- Billing settings are accounting configuration, not subscription policy.
- The current deep technical settings controls are acceptable for developer-operated use, but future SaaS/operator rollout should gate or hide them behind advanced, developer, or admin-only access.
- Consider existing packages for generic concerns when they clearly reduce risk or maintenance cost, but keep billing, consent, reconciliation, retry, and accounting policy explicit in local code.
- Continue future policy work from `subscription-policy.md` and `recurring-billing-policy.md`, not from archived handoff notes.
