# Implementation Roadmap

Status: active; sole authority for development order
Audience: product and engineering

## How To Use This Roadmap

Read this file before starting product work. It defines the current end goal,
active milestone, completion gate, and allowed execution order.

Supporting documents have narrower roles:

- `feature-inventory.md` records current capability evidence; it does not set priority.
- `multi-tenant-pilot-scope.md` preserves the tenant-isolation baseline.
- `subscription-policy.md` defines subscription lifecycle and consent policy.
- `recurring-billing-policy.md` defines collection, invoice notice, and failed-payment policy.
- operations documents explain how to run already-approved workflows.

If another document conflicts with this roadmap on development order, this
roadmap wins. Update the conflicting document before continuing.

## Product End Goal

Each tenant can securely connect its own Mollie organization through OAuth.
Existing tenant-scoped customer, payment, payment-link, mandate, subscription,
invoice, webhook, reconciliation, repair, and readiness flows use that
connection without API-key sharing, credential mixing, or implicit fallback.

Normal operators can see whether Mollie is connected, which organization and
profile are active, and what action is required when access is incomplete or
revoked. Existing API-key connections remain temporary migration compatibility,
not the final onboarding model.

## Verified Baseline

The current code already provides:

- membership-led tenant access and active-tenant selection
- tenant-scoped core business data and operator surfaces
- encrypted tenant-owned Mollie API keys and e-Boekhouden credentials
- hosted subscription consent and first-payment onboarding
- Mollie customer, payment-link, mandate, subscription, and payment sync
- fail-closed managed webhook processing with tenant evidence
- failed-payment classification, customer notification evidence, and operator tasks
- provider-neutral invoice records with Mollie and e-Boekhouden adapters
- tenant-aware invoice delivery, resend, download, reconciliation, cron, and repair paths
- provider-aware tenant readiness checks
- normal Needs Attention, customer timeline, notes, and derived lifecycle views

The current Mollie client still authenticates tenant business calls with stored
API keys. OAuth connection identity, token lifecycle, scopes, profile selection,
capability state, revocation, and reconnect behavior do not exist yet.

## Active Milestone: M6 Production Proof And Migration Gate

This is the only active product milestone.

M1 through M5 are complete. The accepted contract is in
[`../integrations/mollie-connect-contract.md`](../integrations/mollie-connect-contract.md).
All tenant SDK and Sales Invoices requests now share the credential-neutral,
tenant-fenced resolver; temporary API-key compatibility remains fail-closed.

Normal operator connection controls now show sanitized organization, selected
profile, scopes/capability readiness, and safe actions. An OAuth connection
remains incomplete until the operator explicitly selects a valid profile.

Goal: record live connected-tenant proof for all existing Mollie flows and the
API-key migration-retirement decision.

M6 is complete only when the live-proof runbook has evidence for customer
creation, first payment, mandate, subscription, payment link, webhook,
reconciliation, Mollie invoicing, readiness, revocation, and reconnect.

## Ordered Mollie Connect Milestones

Work in this order. Do not open a later milestone while an earlier milestone has
unfinished acceptance criteria unless an external blocker is recorded and the
new work still belongs to the same end goal.

### M1: Connection Contract

Define ownership, scopes, authorization, token lifecycle, connection states,
migration compatibility, audit rules, and failure behavior.

### M2: Dual-Auth Foundation

Add an OAuth connection model alongside temporary legacy API-key support. Store
only the connection identity and encrypted credentials required by the M1
contract. Keep every credential lookup explicitly tenant-scoped and fail closed.

### M3: OAuth Lifecycle

Implement authorization start and callback, authorization-code exchange,
concurrency-safe access-token refresh, revoked-consent handling, scope validation,
disconnect, and reconnect. Protect redirects with state validation and keep
tokens out of URLs, logs, audits, and client payloads.

### M4: Existing-Flow Migration

Route every tenant Mollie business operation through one credential-neutral
client resolver. Preserve current tenant fencing, test/live behavior,
idempotency, webhook authority checks, payment truth, and API-key migration
compatibility.

### M5: Connection And Readiness UX

Let an authorized operator connect, reconnect, disconnect, and select the active
profile. Show organization, profile, granted scopes, capability/readiness state,
last verification, and safe next actions. Follow Mollie's Capabilities API
direction instead of creating a new dependency on the deprecated Onboarding API.

### M6: Production Proof And Migration Gate

Prove OAuth-backed customer creation, first payment, mandate establishment,
subscription activation, payment links, webhooks, reconciliation, Mollie
invoicing, readiness, revocation, and reconnect for a real connected tenant.
Document evidence and the explicit gate for retiring manual API-key onboarding.

## Mollie Connect Completion Gate

Mollie Connect is complete only when all six milestones pass:

- existing tenant business flows work through OAuth
- cross-tenant credential use is structurally prevented and covered by tests
- token refresh is concurrency-safe and failures are recoverable without secret leakage
- revoked or incomplete connections fail closed with an actionable operator state
- organization, profile, scopes, and capabilities are visible without raw provider payloads
- API-key tenants can migrate without breaking existing business records
- current payment, invoice, webhook, retry, and reconciliation safeguards still hold
- live connected-tenant proof is recorded
- active docs match implemented behavior

Code completion without live connected-tenant proof is not program completion.
An external Mollie activation or approval dependency must be recorded as an
explicit blocker, not disguised as completed work.

## Non-Negotiable Product Rules

- Mollie remains payment and mandate truth.
- Each stored invoice remains owned by the provider that created it.
- Resolve an explicit tenant before every business read, mutation, webhook,
  replay, repair, cron, invoice, sync, and notification flow.
- Never fall back from a tenant OAuth failure to another tenant or global account.
- Treat webhooks as signals and re-fetch authoritative state before acting.
- Make external side effects idempotent or claim-before-call.
- Keep secrets out of URLs, logs, audits, client payloads, and generic metadata.
- Define money, legal, privacy, and lifecycle policy before code depends on it.
- Keep destructive cleanup report-only, then dry-run, then explicitly scoped apply.
- Keep normal operator UX narrow; raw diagnostics and repair controls remain advanced.
- Update docs in the same slice as behavior changes.

## Execution And Drift Rules

- Keep exactly one active milestone in this file.
- Every implementation slice must close a named acceptance criterion from that milestone.
- Prefer the smallest coherent slice that advances the active completion gate.
- Do not create work from incidental TODOs, aesthetic observations, or nearby refactor opportunities.
- Do not broaden scope because a touched module could be cleaner.
- Refactor only when required to complete or verify the active milestone safely.
- Verify the touched seam first; widen checks in proportion to risk.
- End each slice with result, evidence, blocker if any, and next milestone criterion.
- Keep active status concise. Git and archived summaries hold history.
- When blocked externally, continue only with another unmet criterion inside the
  active milestone; otherwise stop with the exact blocker.

Until the Mollie Connect completion gate closes, do not implement refunds,
chargeback workspaces, balances/settlements, application fees, Resell Pricing,
POS, Marketplace flows, broad role systems, or unrelated operator polish.

## Later Backlog

After Mollie Connect is complete, reassess this queue in order of customer and
money-flow value:

1. provider-side subscription cancellation execution under `subscription-policy.md`
2. controlled refund read/create lifecycle with audit and uncertain-outcome reconciliation
3. chargeback detail and operator follow-up
4. balances and settlements reconciliation for payout/accounting visibility
5. profile and payment-method health improvements beyond the Connect completion gate
6. tenant subscription-policy settings UI
7. plan catalog, invoice-line templates, VAT, and revenue-ledger mapping
8. discounts, trials, setup fees, and proration after catalog policy exists
9. customer self-service cancellation and richer entitlement rules
10. per-subscription policy overrides
11. broader roles, self-serve tenant administration, invites, and platform billing
12. Application Fees or Resell Pricing after commercial and tax policy is approved

Pause/resume remains out of scope while Mollie cancellation is irreversible.
Marketplace, Split Payments, balance transfers, programmatic payouts, Orders,
shipments, and POS remain non-goals until a separate product decision adds them.
