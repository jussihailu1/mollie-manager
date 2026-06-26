# Implementation Roadmap

Status: active roadmap
Audience: product and engineering

## Purpose

This is the autonomous-development roadmap for turning the app into a product that a non-technical operator can use safely, while still allowing advanced configuration for operators who understand accounting, policy, and recovery details.

Use this roadmap before starting feature work. `feature-inventory.md` records what exists; this file defines the order and quality bar for what comes next.

## Product Direction

The app should default to a guided, plain-language workflow:

- show what needs attention
- explain what happened and why it matters
- recommend the safest next operator action
- keep legally required setup explicit but minimal
- hide advanced diagnostics, repair, replay, and policy controls unless the operator has the right access and opens the advanced surface

The app should not require operators to understand Mollie internals, e-Boekhouden internals, SEPA timing, retry policy, or invoice-state implementation details for normal use.

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
- failed payment follow-up should recommend actions before automating consequences
- customer communication should be stored with outcome evidence

Acceptance criteria:

- state transition policy documented before code
- pre-execution request lifecycle (`pending`, `scheduled`, `processing`, `withdrawn`) documented before UI or server-action transitions
- pure state-transition helpers with tests
- audit trail for every lifecycle action
- no conflict with fixed-term subscription semantics

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

- tenant/app defaults remain the simple path
- overrides must be advanced and visibly exceptional

Acceptance criteria:

- policy precedence is explicit: app default -> tenant default -> customer/subscription override
- every override is included in customer-facing consent where relevant
- override audit trail exists
- no override silently changes already-agreed customer terms

## Very Late Platform Track

These are intentionally far future:

- real roles such as admin, finance, support, developer, and auditor
- multi-user invites
- tenant separation and broader SaaS management
- customer self-serve portal beyond simple invoice downloads or recovery links
- full onboarding for new users of this app

Reason:

- the app should first become correct, understandable, and safe for one operational context before adding platform breadth.

## Current Autonomous Development Order

1. Phase 0 failed payment correctness
2. Phase 1 needs attention dashboard
3. Phase 2 customer timeline and derived lifecycle state
4. Phase 3 noob-friendly UX and invoice resend/downloads
5. Phase 4 retention policy UI and dry-run cleanup
6. Phase 5 subscription operations
7. Phase 6 plan catalog and accounting mapping
8. Phase 7 advanced policy overrides
9. very late platform track

If a later feature needs a Phase 0-4 foundation, build the foundation first.
