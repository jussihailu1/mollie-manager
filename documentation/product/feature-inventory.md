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

- [ ] Subscription management exists, but mostly inside customer workflows rather than a dedicated primary workspace
- [ ] Payment-link functionality exists, but there is no separate primary payment-links workspace
- [ ] Legacy `/alerts` and `/payment-links` routes are compatibility redirects, not active standalone modules
- [ ] Manual webhook replay exists in backend actions, but it is not a prominent operator workflow
  Status: the settings ops surface now exposes a failed-webhook replay queue with failed-only replay controls for the selected mode.
- [ ] Reliability and invoice automation health is spread across `/settings`, `/api/health`, and CLI scripts rather than one unified ops screen
  Status: `/settings` now includes an operator-focused ops overview with health snapshot, failed webhook replay queue, and recent reliability activity; CLI scripts and JSON diagnostics still remain available for deeper inspection.
- [ ] Detailed subscription, mandate, and payment history is available in the data model, but not all of it is surfaced in dense first-class operator views

## Planned Next

- [x] Add explicit reconciliation modes so operators can choose `sync-only` versus flows that may trigger invoice-side actions
  Status: `/settings` now exposes explicit `sync_only` and `full` reconciliation modes. `sync_only` is the least-dangerous default and avoids automatic first-payment invoice creation and subscription activation follow-ups.
- [ ] Expand reconciliation output with first-payment and recurring invoice-state deltas for easier operator review
- [ ] Unify stale-sync, webhook-health, and invoice-automation observability into a clearer operator surface
- [ ] Expose safer, clearer operator controls for webhook replay and repair flows
- [ ] Decide whether subscriptions need a dedicated operations workspace again or should stay embedded in customer workflows

## Cross-Cutting Hardening Work

Reference: `../development/codebase-review.md`

- [ ] Remove consent-token leakage from redirect notices, audit logs, and non-essential metadata while improving the operator share-link workflow
  Status: the hashed lookup-token follow-up is implemented. Canonical lookup uses a hash, operator link regeneration uses encrypted recovery, and a one-time backfill script removes legacy plaintext rows after the schema migration.
  Reference: `../development/track-a-onboarding-hardening-plan.md`
- [ ] Split public health/liveness from authenticated operator diagnostics and reduce operational detail exposed anonymously
  Status: `/api/health` now returns minimal public liveness by default, while full diagnostics are available to cron bearer auth and authenticated operators; `/settings` now surfaces a clearer operator view over the same reliability signals.
- [ ] Stop persisting secret-bearing webhook URLs into generic metadata and reduce secret sprawl
  Status: the metadata persistence path is gone, the payment drawer no longer exposes raw callback URLs, and newly generated Mollie webhook URLs are secret-free; webhook processing now requires managed local resource resolution.
- [ ] Harden invoice PDF fetch and attachment handling with trusted-host, timeout, and size controls
  Status: trusted e-Boekhouden-only URL handling, redirect/timeout/size controls, and payment-drawer attachment status are now in place; the remaining work is broader ops-surface visibility only if it proves necessary.
- [ ] Add integration coverage for consent, webhook sync, first-payment invoice creation, recurring invoice delivery retry, and repair flows
- [ ] Refactor oversized billing/orchestration modules into smaller policy, state-transition, and integration units

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
- Continue future policy work from `subscription-policy.md` and `recurring-billing-policy.md`, not from archived handoff notes.
