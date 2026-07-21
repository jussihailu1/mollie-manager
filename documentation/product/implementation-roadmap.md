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
- `kify-owned-invoicing-direction.md` records the accepted invoice ownership direction.
- `kify-owned-invoicing-implementation-plan.md` is the detailed execution
  contract for the active Kify-owned invoicing milestone.
- operations documents explain how to run already-approved workflows.

If another document conflicts with this roadmap on development order, this
roadmap wins. Update the conflicting document before continuing.

## Product End Goal

Each tenant can issue and deliver compliant invoices through Kify without
depending on Mollie Invoicing or e-Boekhouden activation. Kify owns invoice
identity, immutable data, rendered documents, delivery, resend, download, and
history. Mollie remains authoritative for payment collection, mandates,
subscriptions, and payment state; e-Boekhouden is optional accounting sync.

Tenant business flows remain explicitly tenant-scoped and use each tenant's
Mollie organization without API-key sharing, credential mixing, or implicit
fallback. Normal operators see invoice readiness separately from Mollie payment
readiness.

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

The accepted invoice direction is documented in
[`kify-owned-invoicing-direction.md`](./kify-owned-invoicing-direction.md): Kify
will own invoice issuance and delivery, Mollie will remain payment truth, and
e-Boekhouden will be optional accounting synchronization. Current code still
uses Mollie/e-Boekhouden invoice-provider adapters; Kify-owned issuance is not
implemented yet.

Mollie Connect M1 through M5 are implemented. OAuth connection identity, token
lifecycle, scopes, profile selection, capability state, revocation, reconnect,
and credential-neutral business calls exist. M6 still requires live proof with
a real connected tenant.

## Active Milestone: Kify-Owned Invoicing

This is the only active product milestone.

Goal: implement and prove Kify-native automated invoicing using the detailed
contract in
[`kify-owned-invoicing-implementation-plan.md`](./kify-owned-invoicing-implementation-plan.md).
Kify will issue new invoices, render Dutch PDFs through a provider-neutral
native PDFKit renderer, store artifacts privately, and preserve existing
delivery, retry, legacy-document, tenant-isolation, and money-flow safeguards.

Work through K1 through K8 in order. K1 through K4 are complete; K5 automated
workflow integration is the current implementation milestone.
The active program is complete only after controlled live-tenant proof and K8
archives the implementation plan and promotes the next roadmap milestone.

## Externally Blocked Milestone: Mollie Connect M6

Mollie Connect M1 through M5 are complete under
[`../integrations/mollie-connect-contract.md`](../integrations/mollie-connect-contract.md).
M6 production proof remains externally blocked pending a real connected tenant
and the provider-side capabilities needed to exercise the full live-proof
runbook. Do not represent Mollie Connect as complete until that evidence exists.

This explicit reprioritization permits the Kify-owned invoicing milestone to
advance while preserving M6 code and its unclosed live gate. Resume M6 through
the live-proof runbook when the external prerequisites are available.

## Mollie Connect Milestone Record

M1 through M5 are implemented. M6 is externally blocked as recorded above.

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

Status: externally blocked; not the active implementation milestone.

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

During the active Kify-owned invoicing milestone, do not implement refunds,
chargeback workspaces, balances/settlements, application fees, Resell Pricing,
POS, Marketplace flows, broad role systems, or unrelated operator polish.

## Later Backlog

After Kify-owned invoicing is complete and its plan is retired, reassess this
queue in order of customer and money-flow value while keeping the blocked M6
live proof visible:

1. provider-side subscription cancellation execution under `subscription-policy.md`
2. controlled refund read/create lifecycle with audit and uncertain-outcome reconciliation
3. chargeback detail and operator follow-up
4. balances and settlements reconciliation for payout/accounting visibility
5. optional e-Boekhouden synchronization for Kify-owned invoices
6. profile and payment-method health improvements beyond the Connect completion gate
7. tenant subscription-policy settings UI
8. plan catalog, invoice-line templates, VAT, and revenue-ledger mapping
9. discounts, trials, setup fees, and proration after catalog policy exists
10. customer self-service cancellation and richer entitlement rules
11. per-subscription policy overrides
12. global button contrast and accessibility audit through shared design-system
    tokens; do not apply one-off route-level color fixes
13. broader roles, self-serve tenant administration, invites, and platform billing
14. Application Fees or Resell Pricing after commercial and tax policy is approved

Pause/resume remains out of scope while Mollie cancellation is irreversible.
Marketplace, Split Payments, balance transfers, programmatic payouts, Orders,
shipments, and POS remain non-goals until a separate product decision adds them.
