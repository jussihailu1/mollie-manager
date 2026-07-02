# Implementation Roadmap

Status: active roadmap
Audience: product and engineering

## Purpose

This is the autonomous-development roadmap for turning the app into a product that a non-technical operator can use safely, while still allowing advanced configuration for operators who understand accounting, policy, and recovery details.

Use this roadmap before starting feature work. `feature-inventory.md` records what exists; this file defines the order and quality bar for what comes next.

Near-term release target: a shared-app, manually provisioned multi-tenant pilot
as defined in `multi-tenant-pilot-scope.md`. This is earlier than broad SaaS
administration and does not include self-serve signup, invites, platform
billing, or a full role matrix.

## Product Direction

The app should default to a guided, plain-language workflow:

- show what needs attention
- explain what happened and why it matters
- recommend the safest next operator action
- keep legally required setup explicit but minimal
- hide advanced diagnostics, repair, replay, and policy controls unless the operator has the right access and opens the advanced surface

The app should not require operators to understand Mollie internals, e-Boekhouden internals, SEPA timing, retry policy, or invoice-state implementation details for normal use.

The near-term product target is no longer "one operational context first" in the
release sense. It is a shared-app multi-tenant pilot with manual provisioning
and explicit tenant isolation, while broad tenant administration remains later.

## Hard Rules For All Roadmap Work

These rules prevent repeating previous cleanup and hardening mistakes:

- define money, legal, privacy, or lifecycle policy before code changes that depend on it
- keep Mollie payment truth separate from e-Boekhouden invoice truth
- do not create duplicate invoices for one billing period
- do not automatically pause, cancel, dun, penalize, or escalate a customer after failed payment detection unless a documented policy explicitly allows it
- model state transitions explicitly; do not hide new product state only in untyped JSONB metadata
- keep secret-bearing values out of URLs, logs, audit details, client payloads, and generic metadata
- treat webhooks as signals; re-fetch authoritative state before acting
- make external side effects idempotent or claim-before-call
- add focused pure/helper coverage for policy decisions before adding orchestration
- add dependency-injected seam coverage for flows with external services
- add database-backed coverage when a feature depends on multiple tables staying consistent
- keep public and normal-operator surfaces narrow; put raw diagnostics and repair controls behind advanced access
- resolve an explicit tenant for every tenant business query, mutation, webhook, repair, replay, cron, invoice, sync, and notification flow
- do not allow `AUTH_ADVANCED_EMAILS` or developer mode to bypass tenant membership or tenant context
- use tenant-owned Mollie and e-Boekhouden credentials for tenant business flows; do not fall back to one shared provider account
- keep tenant business data isolated in schema, query scope, audit scope, and operator UI scope
- design destructive cleanup as report-only first, then dry-run, then explicit scoped apply
- update docs in the same slice as behavior changes

## Phase 0: Failed Payment Correctness

Priority: highest

Reason: money flow must be correct before larger product work.

Goal:

- automatically detect unsuccessful payment flows
- notify the customer with clear, policy-safe language
- create an operator task that explains the failure and recommended next step
- keep actual consequences manual or policy-controlled later

Scope:

- recurring payment failures and returns
- first-payment failures during onboarding
- mandate-only setup payment failures
- chargebacks, refunds, and reversals
- missing or unusable mandate signals
- long-pending SEPA payments that pass the safe pending window

Required behavior:

- classify payment outcome into plain states such as `pending`, `paid`, `failed`, `reversed`, `charged_back`, `mandate_problem`, and `needs_review`
- distinguish failed collection from invoice creation or invoice delivery failure
- detect the failure from reconciled Mollie state, not only webhook payloads
- preserve one invoice per billing period
- send a customer notification only when the app has enough evidence to say the payment failed or needs action
- open a durable operator task/alert with the failure reason, customer impact, relevant invoice/payment/subscription links, and safe next action
- do not automatically pause service, cancel subscription, add fees, start collection, or retry indefinitely

Customer notification default:

- plain language
- no threat language
- no automatic penalty wording
- explain that payment did not succeed or was reversed
- mention that the invoice/payment obligation may still be open when legally true
- give the configured contact path or future recovery link

Acceptance criteria:

- failure policy documented in `recurring-billing-policy.md`
- state classification in pure helpers with tests
- customer email composition in isolated helpers with tests
- no duplicate invoice path introduced
- operator task visible in the normal "Needs attention" flow
- audit log written without sensitive payload leakage
- failed payment state can be rebuilt by reconciliation

## Phase 0.5: Multi-Tenant Pilot Foundation

Goal:

- make the app safely usable by multiple tenants in one shared deployment
  without cross-tenant leakage or provider-credential mixing.

Scope:

- tenant entity and tenant membership model
- current-tenant session/context resolution for authenticated operators
- keep normal operator routes on `/customers`, `/payments`, `/notifications`,
  and `/settings`
- public consent/return routes resolve tenant implicitly through the token and
  linked local state
- tenant-owned Mollie credentials
- tenant-owned e-Boekhouden credentials
- tenant-owned subscription policy defaults and billing/accounting settings
- tenant-scoped core business tables, indexes, and uniqueness rules
- tenant-aware webhook, replay, repair, reconciliation, cron, onboarding,
  invoice, and notification flows

Current bounded implementation slice:

- tenant, platform-operator, and operator-membership foundation is already in
  place
- tenant-owned subscription policy defaults and billing/accounting settings are
  already persisted by `tenant_id`, and helper lookups now require explicit
  tenant context instead of a single-tenant fallback
- current slice tenantizes `customers`, `mandates`, `subscriptions`,
  `subscription_operation_requests`, `payments`,
  `recurring_billing_schedules`, `payment_links`,
  `subscription_onboarding_consents`, and `customer_notes`
- normal dashboard, notifications, customer activity, customer drawer invoice
  links, customer drawer invoice resend, customer drawer notes, customer drawer
  billing history, payments, and settings surfaces now resolve the active
  tenant from the signed-in operator's selection cookie through the shared
  tenant-context helper
- current slice also scopes the root customer/payment loaders, payment drawer
  API, and e-Boekhouden relation-search linked-record filtering to explicit
  tenant context, while preserving single-tenant fail-closed behavior until
  membership/session tenant selection lands
- payment drawer invoice-trigger audit lookups now verify tenant-owned payment
  and recurring schedule rows before surfacing audit summaries
- dashboard layout now blocks signed-in operators without tenant membership or
  bootstrap platform-operator access
- tenant-selection shell plumbing now persists the active tenant in a cookie,
  resolves it from the operator's accessible tenant list, and exposes a manual
  switcher in the dashboard menu
- billing settings and advanced invoice automation actions now resolve the
  current tenant before mutating tenant-owned billing state or running batch
  invoice actions
- alert status actions on the operator notifications surface now resolve the
  current tenant before acknowledging or reopening tenant-linked alerts
- subscription operation request actions now resolve the current tenant before
  recording, withdrawing, transitioning, or syncing subscription request state
- recurring-invoice cron fan-out now iterates accessible tenants explicitly so
  invoice create/recovery/retry automation stays tenant-scoped
- recurring-invoice cron heartbeat metrics now read tenant cron audit rows
  directly by tenant audit entity id so settings snapshots stay aligned with
  tenant-local runs
- recent reliability audit activity now includes tenant-linked alert,
  webhook-event, and tenant cron rows
- Needs Attention webhook items now require tenant-linked resources before
  surfacing failed webhook rows
- payment follow-up queue alert joins now verify tenant-owned payments before
  showing queued alert evidence
- alert email lookups now verify tenant-owned linked entities for tenant-backed
  alert delivery paths
- invoice delivery retry and recurring recovery alert emails now carry tenant
  ids from tenant-scoped candidate rows
- recurring invoice schedule candidates now carry tenant ids into invoice
  creation and recovery alert delivery
- recurring invoice creation failure alert delivery now carries tenant ids
- first-payment invoice follow-up now carries explicit tenant context into
  billing settings lookup
- first-payment onboarding and subscription-sync follow-up now carry explicit
  tenant context into tenant-owned subscription policy defaults and invoice
  creation lookup
  from tenant-scoped schedule candidates
- session-authenticated `/api/health` diagnostics now resolve the active tenant
  before reading the shared reliability ops snapshot
- bearer-authorized `/api/health` diagnostics now stay on setup/database checks
  unless an explicit `tenantId` is supplied for the shared tenant-scoped
  reliability snapshot
- tenant-aware Mollie sync/reliability cross-mode lookup helpers now thread
  explicit tenant context through sync, replay, repair, and subscription-sync
  lookups; global/bootstrap `/api/health` diagnostics and the shared
  env-backed fallback remain intentionally deferred
- e-Boekhouden relation detail lookups now require active tenant context
- tenant-owned e-Boekhouden credential storage now exists, manual
  `tenant:provision` can seed those credentials, and relation search/detail plus
  billing-settings discovery now resolve e-Boekhouden credentials per tenant
- e-Boekhouden client credential resolution now fails closed without explicit
  tenant context, while the explicit `legacy-default` bootstrap tenant remains
  readable through the env-backed fallback until a later backfill slice
- first-payment and recurring invoice create/reconcile flows, invoice PDF fetch
  paths, and onboarding relation patch flows now thread explicit tenant context
  into live e-Boekhouden invoice and relation reads/writes
- first-payment and recurring invoice candidate lookups, invoice-claim writes,
  invoice-created state writes, and invoice-delivery alert resolution now fence
  by tenant id through the invoice automation follow-up path
- tenant-owned Mollie credential storage now exists, manual `tenant:provision`
  can seed mode-specific Mollie API keys, and tenant-aware Mollie client
  resolution now drives onboarding customer creation, first-payment payment-link
  creation, subscription activation, billing repair, with payment-link
  follow-up now threading explicit tenant context, payment-link sync, mandate
  sync, and payment drawer live fetches
- tenant-owned Mollie and e-Boekhouden credential encryption now writes through
  dedicated `APP_ENCRYPTION_KEY` ciphertext while keeping legacy
  `AUTH_SECRET`-encrypted tenant rows readable until a later re-encryption or
  backfill slice
- consent-link lookup now resolves the active tenant before reading latest
  customer consent URLs
- customer activity, invoice-link, customer-note, and customer-notification
  history helpers now require explicit tenant context instead of a
  single-tenant fallback
- onboarding customer actions now thread the active tenant through customer
  creation, linking, archival, restoration, first-payment creation, and billing
  repair flows
- onboarding helper/data reads and first-payment/recurring invoice helper
  queries now fail closed without explicit tenant context instead of falling
  back to a single-tenant default
- reconciliation fan-out now carries the active tenant into payment and
  payment-link sync dependencies
- reconciliation entrypoints now fail closed without explicit tenant context
  instead of widening to all tenants
- sync resource-state lookups now fail closed without tenant context instead of
  falling back to a single-tenant default
- tenant-scoped reconciliation summaries now keep their before/after invoice
  state deltas scoped to the active tenant through fan-out
- billing-repair payment-link follow-up now threads explicit tenant context
  instead of the old tenant-less sync fallback, and payment-link sync still
  requires explicit tenant context instead of a single-tenant fallback
- invoice email delivery now carries tenant context through first-payment and
  resend flows instead of global fallback
- invoice delivery helper metadata reads and invoice-state writes now fence by
  tenant id instead of bare payment or schedule ids
- managed webhook intake now requires resolved tenant-local resource context
  before sync/provider calls
- managed webhook_events now persist tenant ids, and replay and repair
  operator actions now require the current tenant when replaying failed
  webhooks or running targeted repair actions
- payment follow-up queue, pending subscription request queries, invoice
  automation metrics, dashboard reliability reads, and repair helper entry
  points now fail closed without explicit tenant context, with dashboard
  webhook history reads fenced by tenant directly and failed-webhook repair
  status writes keeping tenant scope in the update path
- repair candidate alert lookups now verify tenant-owned payments,
  subscriptions, and customers before surfacing repair priority
- alert open/resolve/email-sent helper writes now require tenant context, and
  unresolved alert uniqueness is now scoped by tenant-backed alert payload and
  linked entities
- alerts, audit logs, replay/repair/cron follow-up, and broader live
  e-Boekhouden mutation flows remain deferred follow-up inside Phase 0.5

Required behavior:

- signing in alone does not grant product access
- an operator may access tenant data only through explicit membership or a
  controlled platform-operator bootstrap path
- one tenant is active for an authenticated operator workflow at a time
- no tenant business flow may use an implicit app-wide default tenant
- no tenant business flow may use one global provider account as payment or
  accounting truth
- cross-tenant data must not appear in normal or advanced operator surfaces
- current money-flow safeguards must still hold after tenant scoping
- normal operator shell state now remembers an active tenant, but business
  query consumers still need to be threaded through that tenant explicitly

Acceptance criteria:

- canonical scope is documented in `multi-tenant-pilot-scope.md`
- tenant entity and operator membership model are documented before code
- schema and query rules make tenant scope explicit for tenant business data
- tenant-owned provider credential resolution exists before live tenant actions
- webhook and cron follow-up cannot proceed without resolved tenant context
- focused tests prove no cross-tenant read/write leakage in core flows
- current hosted onboarding and billing flows still work with tenant resolution
- broad SaaS administration remains out of scope

## Phase 1: Needs Attention Dashboard

Goal:

- make the app show normal operators what to fix first without needing raw diagnostics.

Scope:

- failed or reversed payments
- payment issue customer tasks
- failed invoices
- failed invoice email delivery
- failed webhooks
- missing e-Boekhouden relation links
- stale Mollie sync state
- missing mandate or mandate problem
- setup blockers

Required behavior:

- group items by urgency and business impact
- use plain labels and recommended action text
- link directly to the customer, payment, invoice, or settings location needed to resolve the issue
- keep replay/repair raw controls in advanced surfaces, but show safe operator explanations in normal surfaces

Acceptance criteria:

- dashboard cards are driven by shared query helpers
- each item has stable type, severity, entity references, and recommended action
- source data is covered by focused tests
- no raw webhook payloads or sensitive metadata shown to normal operators
- current source list stays frozen until docs explicitly add a new attention class

## Phase 2: Customer Activity Timeline And Derived Lifecycle State

Goal:

- make a customer's history understandable without inspecting multiple tables.

Scope:

- customer notes
- automatic activity from audit logs, alerts, payments, invoices, subscription changes, consent, and email delivery
- derived customer lifecycle state

Lifecycle state model:

- use derived state first
- no manual override in near-term scope
- possible states: onboarding, active, payment issue, paused, cancelled, ended, needs setup
- the state should explain its source, for example "payment issue because latest recurring payment failed"

Acceptance criteria:

- timeline query has stable item types
- notes are separate from audit logs
- lifecycle state is derived by a pure helper with tests
- UI explains why a state appears
- manual override remains out of scope until a future product decision

## Phase 3: Noob-Friendly Operator UX

Goal:

- make normal workflows clear for someone with little technical or financial knowledge.

Scope:

- better customer-facing return page after Mollie checkout
- clear SEPA pending, failed, and reversed messaging
- operator copy that explains invoice/payment/subscription state in plain language
- invoice download links for operators
- manual invoice resend from customer or payment drawer
- setup checklist with only legally/business-required setup visible by default

Required behavior:

- explain "pending" as normal for SEPA when applicable
- explain "failed" without implying cancellation or penalties
- keep advanced configuration available but out of the primary path
- show "what to do next" near every issue state
- keep the operator aware of the active tenant context without requiring
  tenant-namespaced URLs

Acceptance criteria:

- customer-facing copy is centralized enough to review
- invoice URLs continue to use trusted-source guardrails
- resend actions are idempotent and audited
- normal setup does not expose raw cron, webhook, or repair concepts

## Phase 4: Retention Policy UI And Dry-Run Cleanup

Goal:

- move retention from report-only to accepted policy display plus safe dry-run tooling.

Scope:

- UI showing the accepted retention policy
- dry-run cleanup report
- no destructive apply until dry-run output is reviewable and the operator explicitly scopes the cleanup

Required behavior:

- separate live and test data decisions
- any future operator-facing report or apply path must also require explicit
  tenant scope
- preserve invoice, payment, mandate, consent, and audit evidence unless policy explicitly allows removal
- redact or delete stale personal-data fragments only through scoped rules
- every future destructive action must require explicit mode/table/window selection

Acceptance criteria:

- policy values stored explicitly
- dry-run output explains row counts and evidence impact
- no default destructive cleanup
- docs and runbook updated before any apply path exists

## Phase 5: Subscription Operations

Goal:

- support common customer lifecycle workflows without accidental financial consequences.

Scope:

- subscription pause/resume flow
- cancellation workflow with reason, effective date, and audit trail
- payment failure follow-up queue
- customer notification history

Required behavior:

- pause/resume/cancel actions are explicit operator actions
- cancellation must separate service end, billing end, and collection state
- pre-execution request statuses must have explicit meaning before any provider execution is implemented
- provider execution must require fresh Mollie re-fetch before action and provider confirmation after action
- failed payment follow-up should recommend actions before automating consequences
- customer communication should be stored with outcome evidence

Acceptance criteria:

- state transition policy documented before code
- pre-execution request lifecycle (`pending`, `scheduled`, `processing`, `withdrawn`) documented before UI or server-action transitions
- execution-state policy (`processing` -> `applied|failed`, retry/requeue rules, confirmation rules) documented before provider mutation code
- pure state-transition helpers with tests
- audit trail for every lifecycle action
- no conflict with fixed-term subscription semantics
- payment follow-up queue remains read-only evidence unless the roadmap later adds an explicit ownership/due-date/disposition slice

## Phase 6: Plan Catalog And Accounting Mapping

Goal:

- stop forcing operators to type or remember recurring commercial/accounting details.

Scope:

- plan catalog
- product/service line templates for e-Boekhouden invoices
- VAT and revenue ledger mapping by plan
- setup fee support
- trial support
- discount support
- proration rules for mid-cycle changes

Order:

1. plan catalog
2. invoice line templates
3. VAT and ledger mapping by plan
4. setup fees
5. trials and discounts
6. proration

Reason:

- proration and discounts are risky until plan, period, invoice-line, VAT, and ledger semantics are explicit.

Acceptance criteria:

- plan changes are versioned or snapshotted into customer consent and invoice evidence
- accounting mappings are validated before activation
- generated invoices can be explained from stored plan/line snapshots
- customer-facing consent shows the actual financial terms

## Phase 7: Advanced Policy Overrides

Goal:

- support business-specific policy variation without confusing normal users.

Scope:

- per-customer or per-subscription policy overrides
- custom invoice notice days
- custom cancellation behavior
- custom recovery rules

Default:

- tenant defaults remain the simple path
- overrides must be advanced and visibly exceptional

Acceptance criteria:

- policy precedence is explicit: platform fallback -> tenant default -> customer/subscription override
- every override is included in customer-facing consent where relevant
- override audit trail exists
- no override silently changes already-agreed customer terms

## Very Late Platform Track

These are intentionally far future:

- real roles such as admin, finance, support, developer, and auditor
- multi-user invites
- self-serve tenant signup
- broad tenant administration UX
- platform billing
- tenant SMTP overrides and richer provider-linking UX
- customer self-serve portal beyond simple invoice downloads or recovery links
- full onboarding for new users of this app

Reason:

- the app should first become correct, understandable, safe, and tenant-isolated
  before adding broader platform administration.

## Current Autonomous Development Order

1. Phase 0 failed payment correctness
2. Phase 0.5 multi-tenant pilot foundation
3. Phase 1 needs attention dashboard
4. Phase 2 customer timeline and derived lifecycle state
5. Phase 3 noob-friendly UX and invoice resend/downloads
6. Phase 4 retention policy UI and dry-run cleanup
7. Phase 5 subscription operations
8. Phase 6 plan catalog and accounting mapping
9. Phase 7 advanced policy overrides
10. very late platform track

If a later feature needs a Phase 0, Phase 0.5, or Phase 1-4 foundation, build
the foundation first.
