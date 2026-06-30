# Feature Inventory

Status: active planning doc
Audience: product and engineering

Use this file as the working inventory for ongoing development.

Canonical policy docs:

- `implementation-roadmap.md`
- `multi-tenant-pilot-scope.md`
- `subscription-policy.md`
- `recurring-billing-policy.md`
- `subscription-roadmap.md`

Roadmap rule: feature sequencing comes from `implementation-roadmap.md`. This file records current inventory and backlog state.

## Implemented

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

- [x] Google sign-in exists as the current authentication provider, but the current single allowlisted-email gate is legacy
  Status: current code still uses Google sign-in plus one allowed operator email for access bootstrap. This is not the target state for the shared multi-tenant pilot. The multi-tenant foundation must replace the global allowlisted-email product gate with membership-based tenant access while keeping Google as one supported provider.
- [x] Subscription management intentionally lives inside customer workflows rather than a dedicated primary workspace
  Status: a customer is the operator's primary subscription context for this product, so a separate subscription screen is not planned.
- [x] Payment-link functionality intentionally lives inside customer onboarding rather than a dedicated primary workspace
  Status: payment links are onboarding artifacts, not a separate operator management object.
- [x] Legacy `/alerts` and `/payment-links` routes are compatibility redirects, not active standalone modules
  Status: this is intentional while notifications/settings and customer onboarding remain the real operator surfaces.
- [x] Manual webhook replay and targeted repair are surfaced in the settings ops workflow
  Status: the settings ops surface now exposes a failed-webhook replay queue with failed-only replay controls and explicit replay confirmation, plus a targeted repair form for single customer/payment/subscription resyncs.
- [x] Reliability and invoice automation health is unified across advanced `/settings` controls and `/api/health`
  Status: advanced settings controls and advanced/cron `/api/health` diagnostics now share the same reliability ops snapshot for webhook health, invoice automation, delivery retries, and cron heartbeat; CLI scripts still remain as deeper fallbacks.
- [x] Deep technical operations controls can remain in settings during developer-operated use
  Status: billing/accounting settings remain available to normal authenticated operators, while diagnostics, repair, replay, reconciliation, SMTP tests, and invoice batch/retry controls are gated behind `AUTH_ADVANCED_EMAILS` and collapsed behind a developer mode toggle.
- [x] Detailed subscription, mandate, and payment history is surfaced in dense customer-centered operator views
  Status: the customer drawer now lazy-loads protected billing history and shows compact subscription, mandate, and payment rows without adding standalone subscription or payment-link workspaces.

## Canonical Access Rules

- Normal authenticated operator:
  - must have tenant membership for the active tenant before using tenant business workflows
  - may use normal customer, payment, notification, invoice, and billing/accounting configuration workflows inside that active tenant
  - may not access raw diagnostics, replay, repair, reconciliation, SMTP test, or invoice batch/retry controls unless also in `AUTH_ADVANCED_EMAILS`
- Advanced operator:
  - is an already-authorized operator whose email is listed in `AUTH_ADVANCED_EMAILS`
  - may access advanced technical controls only inside the active tenant context in addition to normal operator workflows
- Platform operator:
  - is a controlled bootstrap/admin path for platform-level setup work such as tenant provisioning or membership maintenance
  - does not make tenant business data global; tenant business actions still require explicit tenant context
- Developer mode toggle:
  - only reveals or hides advanced controls in the UI
  - does not grant authorization by itself
- New operator-facing controls should default to normal authenticated tenant-member access unless they expose raw diagnostics, destructive repair, replay, batch retry, or similarly technical internals
- No normal or advanced operator surface may aggregate tenant business data across tenants by default

## Active Next

- [ ] Shared multi-tenant pilot foundation
  Status: in progress. Tenant, platform-operator, and operator-membership tables now exist. Tenant-owned subscription-policy defaults and tenant billing/accounting defaults now persist by `tenant_id` instead of one shared `"default"` row, and a manual `npm run tenant:provision` bootstrap path now creates tenant rows plus default settings. The foundation backfills one `legacy-default` tenant to preserve the current single-context deployment while the broader pilot is still being built. The current slice tenantizes the core customer-linked business table set (`customers`, `mandates`, `subscriptions`, `subscription_operation_requests`, `payments`, `recurring_billing_schedules`, `payment_links`, `subscription_onboarding_consents`, and `customer_notes`), scopes the root customer/payment loaders to explicit tenant context with single-tenant fail-closed behavior, blocks dashboard access unless the signed-in operator has tenant membership or bootstrap platform-operator access, and now threads the active tenant into the normal dashboard, notifications, customer activity, customer drawer invoice links, customer drawer invoice resend, customer drawer notes, customer drawer billing history, payments, settings, payment drawer lookups, e-Boekhouden relation-search linked-record filtering and relation detail lookups, subscription operation request actions, billing settings updates, advanced invoice automation actions, alert status changes, recurring-invoice cron/retry/recovery fan-out, cron heartbeat metrics, recent reliability audit activity, tenant-scoped failed-webhook Needs Attention rows, payment follow-up queue alert joins, repair candidate alert lookups, tenant-backed alert email delivery, invoice delivery retry / recurring recovery alert emails, recurring invoice schedule candidates, recurring invoice creation failure alert delivery, session-authenticated `/api/health` reliability diagnostics, consent-link lookup through cookie-backed selection, onboarding customer actions for creation, linking, archival, restoration, first-payment creation, and billing repair, reconciliation fan-out into payment and payment-link sync dependencies, explicit tenant context in payment-link sync itself instead of a single-tenant fallback, invoice email delivery through first-payment and resend flows without global tenant fallback, tenant-fenced invoice-delivery helper metadata reads and invoice-state writes instead of bare payment or schedule ids, explicit tenant context in tenant-owned billing settings and subscription-policy-default helpers instead of single-tenant fallback, explicit tenant context in first-payment onboarding and subscription-sync follow-up into subscription policy defaults and invoice creation, explicit tenant context in alert-email lookup and shared Needs Attention query helpers instead of a legacy single-tenant fallback, and explicit tenant context in dashboard-side reliability reads for alerts, webhook history, and audit history. Customer activity, invoice-link, customer-note, customer-notification-history, payment follow-up queue, pending subscription request, invoice-automation metrics, repair, onboarding helper/data, and first-payment/recurring invoice helper paths now fail closed without an implicit single-tenant fallback. Sync resource-state lookups now fail closed without tenant context, the payment/subscription sync orchestration threads resolved tenant context more consistently through mandate lookup and follow-up paths, and reconciliation invoice-state deltas stay tenant-scoped both before and after sync fan-out. Webhook intake now resolves managed local tenant context before syncing Mollie resources, and the operator replay/repair surfaces now require the current tenant when replaying failed webhooks or running targeted repair actions. The broader business/query surfaces that still read globally, tenant-owned Mollie and e-Boekhouden credentials, and the remaining cron/audit/alerts follow-up still remain. This pilot track remains intentionally limited to manual provisioning. It still does not include self-serve signup, invites, platform billing, broad tenant administration UX, or tenant-specific SMTP.
- [ ] Failed payment correctness
  Status: top priority. Classification foundation is implemented in pure helpers for failed, reversed, charged-back, mandate-problem, first-payment, mandate-only, and unsafe long-pending payment flows. Policy-safe customer notification composition is isolated in a pure helper. The normal Needs Attention query surfaces classified recurring failed/reversed/mandate-problem payments with safe manual next-action wording. Failed-payment customer notification has typed claim-before-send persistence after reconciled Mollie sync, with bounded retry/stale-claim recovery and per-attempt lease tokens so sent rows cannot be reclaimed and stale workers cannot finalize a newer attempt. Durable operator alerts are opened independently of SMTP configuration, and unresolved alert uniqueness is now database-enforced so concurrent reconciliation cannot create duplicate open/acknowledged tasks; missing SMTP suppresses only the customer email claim/send so reconciliation can still rebuild the operator task. Actual pause, cancellation, dunning, fees, or collection consequences stay manual or future policy-controlled.
- [ ] Needs attention dashboard
  Status: substantially implemented. The dashboard and notifications page now use a shared Needs Attention query with stable item types, severity, entity links, and recommended actions for failed/reversed/expired payments, failed first-payment and recurring invoices, failed invoice email delivery, missing or broken e-Boekhouden relation links, stale Mollie sync state, missing mandate/setup blockers, subscription payment-action/out-of-sync states, failed webhooks, and pending subscription cancellation requests. Normal operator surfaces now group those items by priority and business-impact labels so operators can see what is urgent before acting. Raw webhook payloads stay out of normal operator output. Current source list is intentionally frozen for autonomous development; do not add new Needs Attention source types unless this doc or `implementation-roadmap.md` is updated first.
- [ ] Customer notes, activity timeline, and derived lifecycle state
  Status: mostly complete. A pure derived lifecycle helper now maps existing customer/payment/subscription/setup facts into `onboarding`, `active`, `payment_issue`, `paused`, `cancelled`, `ended`, and `needs_setup` with a reason and plain-language explanation; the customer table and drawer display that derived state without manual override controls. A server-side customer activity timeline query now has stable item types for customer creation, consent, payments, invoices, subscription status, subscription operation requests, alerts, customer notes, failed-payment customer notification, and audit summaries without selecting raw audit details, alert payloads, webhook payloads, generic metadata blobs, operator reasons, or requester emails; the customer drawer loads those sanitized timeline rows through an authenticated customer activity API. Customer notes now have an explicit `customer_notes` table with typed source and legacy `customers.notes` backfill, plus authenticated note create/read APIs and drawer note composer. Customer create/link workflows now stop writing new note text into the legacy customer row and persist operator-entered note text through `customer_notes` while still syncing the e-Boekhouden relation note field where relevant. Manual override remains out of scope.
- [ ] Retention policy UI and dry-run cleanup
  Status: the accepted policy is encoded in a typed shared source and displayed in settings for authenticated operators. The retention CLI now supports explicit read-only inventory and live/test dry-run candidate reports with fixed policy windows, aggregate-only output, preserved-evidence impact, and zero proposed mutations. Audit detail redaction remains review-only, while generic metadata and broad test-data cleanup remain blocked pending explicit allowlists. Those allowlists must be documented in product/development docs first and then enforced in typed code; do not infer cleanup eligibility ad hoc from implementation convenience. No destructive apply path exists.

## Recently Completed Planning Items

- [x] Add explicit reconciliation modes so operators can choose `sync-only` versus flows that may trigger invoice-side actions
  Status: `/settings` now exposes explicit `sync_only` and `full` reconciliation modes. `sync_only` is the least-dangerous default and avoids automatic first-payment invoice creation and subscription activation follow-ups.
- [x] Expand reconciliation output with first-payment and recurring invoice-state deltas for easier operator review
  Status: `/settings` now shows the latest reconciliation result with before/after invoice-state deltas for first-payment rows and recurring billing schedules, so operators can confirm normalization and invoice-side changes without digging through raw tables.
- [x] Unify stale-sync, webhook-health, and invoice-automation observability into a clearer operator surface
  Status: advanced `/settings` controls use the shared reliability ops snapshot for webhook health, stale repair context, invoice automation, delivery retries, and cron heartbeat; advanced/cron `/api/health` diagnostics use the same source.
- [x] Expose safer, clearer operator controls for webhook replay and repair flows
  Status: the settings page now includes explicit replay confirmation for failed webhook events and a targeted repair form for customer/payment/subscription resyncs.
- [x] Decide whether subscriptions need a dedicated operations workspace again or should stay embedded in customer workflows
  Status: subscriptions stay embedded in customer workflows unless future usage shows a concrete operator need for a separate workspace.

## Cross-Cutting Hardening Work

Reference: `../development/codebase-review.md`

- [x] Remove consent-token leakage from redirect notices, audit logs, and non-essential metadata while improving the operator share-link workflow
  Status: the hashed lookup-token follow-up is implemented. Canonical lookup uses a hash, operator link regeneration uses encrypted recovery, and a one-time backfill script removes legacy plaintext rows after the schema migration.
- [x] Split public health/liveness from advanced operator diagnostics and reduce operational detail exposed anonymously
  Status: `/api/health` now returns minimal public liveness by default, while full diagnostics are available to cron bearer auth and advanced operators; `/settings` now surfaces a clearer operator view over the same reliability signals for advanced operators.
- [x] Stop persisting secret-bearing webhook URLs into generic metadata and reduce secret sprawl
  Status: the metadata persistence path is gone, the payment drawer no longer exposes raw callback URLs, and newly generated Mollie webhook URLs are secret-free; webhook processing now requires managed local resource resolution.
- [x] Harden invoice PDF fetch and attachment handling with trusted-host, timeout, and size controls
  Status: trusted e-Boekhouden-only URL handling, redirect/timeout/size controls, and payment-drawer attachment status are now in place; the remaining work is broader ops-surface visibility only if it proves necessary.
- [x] Add integration coverage for consent, webhook sync, first-payment invoice creation, recurring invoice delivery retry, and repair flows
  Status: focused executable coverage now exists at the key flow seams: consent acceptance parsing and injected acceptance orchestration, webhook ingestion/status handling, invoice creation batch mapping, invoice delivery retry batch mapping, and targeted repair routing. A heavier DB-backed end-to-end harness remains optional future hardening rather than a current blocker.
- [x] Refactor oversized billing/orchestration modules into smaller policy, state-transition, and integration units
  Status: closed for current scope. `lib/onboarding/actions.ts` is now mostly thin server-action wrappers, invoice creation/retry/recovery logic is split into dedicated modules, and the remaining `lib/reliability/sync.ts` / `lib/eboekhouden/recurring-invoices.ts` files are deliberately accepted as orchestration wrappers unless future changes bloat them again. Retention/compliance is now next.

## Deferred Or Later

- [ ] pause/resume and cancellation workflows with reason, effective date, and audit trail
  Status: pure operation policy foundation, typed durable operation-request storage, and audited request recording from the customer workflow are implemented. Operators can record only pending cancellation intent for active open-ended provider subscriptions with a reason and effective date. Recording intent writes sanitized audit evidence, prevents duplicate unresolved requests, and does not call Mollie, schedule execution, mutate invoices/payments, end service, pause, resume, or cancel anything. The policy preserves existing invoice/payment collection state, distinguishes immediate service end from paid-period service end, requires scheduling before any future provider mutation, blocks fixed-term cancellation pending an early-termination policy, and blocks pause/resume because Mollie cancellation is not reversible. Unresolved requests now surface in normal operator Needs Attention, the notifications workspace, and the customer drawer with safe dates, status, recommended action, and explicit operator-only transitions between `pending`, `scheduled`, `processing`, and `withdrawn`, each backed by sanitized audit evidence only. Withdrawn requests stay visible through customer activity history without exposing operator reason, requester email, or raw metadata. Pre-execution status semantics are documented and implemented, and future provider-execution rules are now documented for when `scheduled` becomes eligible, how `processing` may become `applied` or `failed`, how retry/requeue should work, and what normalized audit detail is allowed. Remaining work is implementing actual provider-side cancellation flow against those rules.
- [ ] payment failure follow-up queue
  Status: a read-only operator queue now joins each failed/reversed/mandate-problem payment to its durable follow-up alert and customer-notification delivery evidence in the selected Mollie mode. It deduplicates concurrent alert rows, shows open/acknowledged/resolved or missing task state, sent/failed/in-progress/skipped/missing notification state, safe timestamps and attempt counts, and filters without exposing recipients, subjects, errors, payloads, metadata, or claim tokens. Completed follow-up tasks no longer remain in generic Needs Attention. The customer drawer also has a dedicated typed notification history with outcome, status, attempts, template version, and payment link while excluding delivery addresses, errors, payloads, metadata, and claim leases. No retry, pause, cancellation, fee, dunning, or collection mutation is available from these views. Ownership, due-date, reminder, SLA, and richer disposition workflow are intentionally deferred. Current scope ends at durable alert/task visibility, customer-notification evidence, and manual operator follow-up outside the app. Do not add queue assignment, due-date derivation, reminder automation, or extra closure workflow unless the roadmap explicitly schedules that slice first.
- [x] better customer-facing Mollie return page with clearer success, pending, and failed states
- [ ] manual invoice resend and operator invoice download links
  Status: implemented for customer-centered workflow. Payment drawer shows guarded invoice download links when a trusted e-Boekhouden PDF URL is available. Customer drawer loads authenticated customer invoice links for first-payment and recurring invoices through a server helper that normalizes trusted e-Boekhouden PDF URLs before returning client data. Customer drawer also supports confirmed manual resend of an existing invoice email through the existing invoice delivery path; it does not create invoices.
- [ ] plan catalog, invoice line templates, and VAT/revenue ledger mapping by plan
- [ ] discounts, trials, setup fees, and proration rules after plan/catalog foundations exist
- [ ] per-customer or per-subscription policy overrides
- [ ] customer self-serve cancellation
- [ ] richer entitlement rules separate from billing state
- [ ] automated dunning, collection fees, or legal collections flows
- [ ] real roles such as admin, finance, support, developer, and auditor
- [ ] full new-user onboarding for this app
- [ ] broader multi-tenant SaaS policy management
  Status: tenant isolation, tenant-owned provider credentials, and tenant-owned policy/default storage are now near-term pilot scope. Broader tenant administration, self-serve signup, invites, platform billing, tenant SMTP overrides, and platform-wide SaaS management remain later-stage scope.

## Constraints And Notes

- Mollie stays the payment source of truth.
- e-Boekhouden stays the invoice and accounting source of truth.
- `mandate_only` EUR 0.01 flows must not create normal subscription invoices.
- Billing settings are accounting configuration, not subscription policy.
- Deep technical settings controls are gated behind `AUTH_ADVANCED_EMAILS` and hidden behind a developer mode toggle; billing/accounting configuration remains available on `/settings` for normal authenticated operators.
- Treat `AUTH_ADVANCED_EMAILS` as the only authorization source for advanced technical controls; developer mode toggle is presentation only.
- Membership-based tenant access is the target authorization model; the current single allowlisted-email gate is legacy bootstrap behavior that must not be extended.
- Tenant business data must never be queried, mutated, displayed, replayed, repaired, or cleaned up without explicit tenant scope.
- Failed-payment detection and customer notification should come before broader feature expansion.
- Consequences after failed payments stay manual until a documented policy permits automation.
- Retention policy is decided; cleanup work can proceed as dry-run first with no automatic destructive defaults.
- Manual customer lifecycle override is far-future; derive lifecycle state from facts first.
- New-user onboarding for this app is a very late feature, after the core product is safe and understandable.
- Consider existing packages for generic concerns when they clearly reduce risk or maintenance cost, but keep billing, consent, reconciliation, retry, and accounting policy explicit in local code.
- Continue future policy work from `subscription-policy.md` and `recurring-billing-policy.md`, not from archived handoff notes.

