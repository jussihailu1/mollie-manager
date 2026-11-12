# Implementation Roadmap

Status: active; sole authority for development order
Audience: product and engineering

**Product purpose, confirmed 12 November 2026:** Kify makes automatic direct debit
(incasso) as easy as possible for businesses. Invoicing and integrations with
bookkeeping software support that collection workflow. Kify is not a bookkeeping
product; the product boundary below governs feature selection.

## Current Delivery Order — 12 November 2026

The invoice-date and sales-posting safeguards are live. The previously authorized
historical repairs are complete; never rerun them or change original invoice dates.
Detailed customer and financial evidence stays outside public Git history.

| Order | Work | Completion gate |
| --- | --- | --- |
| 1 | Existing-tenant receipt rollout | Verify a clean release from production, apply migration 0031, verify the tenant's own account/profile and open periods, configure a future cutoff, deploy and activate. Observe the first genuine automatic receipt separately. |
| 2 | Tenant readiness | Complete the assisted setup, tenant policies, mail identity, explicit accounting support and receipt-capacity acceptance below. Preparation can proceed while a genuine transaction is pending. |
| 3 | Independent-tenant incasso proof | Prove consent, mandate, subscription activation, collection status and failure handling alongside K7 invoice/delivery/recovery/isolation criteria and applicable M6 proof. Complete K8 only after K7 passes. |
| 4 | Bookkeeping integration supporting collections | Synchronize Kify-issued invoices and their receipts to e-Boekhouden. Assess fees/payouts separately against actual collection-administration needs. |
| 5 | Broader self-service product | Tenant signup/invites, broader roles, platform billing and later subscription features follow the assisted pilot. |

See the [receipt release record](../operations/automatic-receipt-release-2026-11-12.md) and
[receipt runbook](../operations/eboekhouden-receipt-automation.md) for verified
status. Local tests and existing-tenant provider reads do not close genuine-payment
or independent-tenant proof. Never create a financial entry solely to obtain proof.

The existing-tenant future-only rollout is authorized after its release checks pass.
Optional bookkeeping consent and its old migration 0030 remain excluded; regenerate
that work as 0032 or later when resumed. Unrelated repairs, fees/payouts, provider-side
relationship cleanup and legacy-key revocation are outside this release.

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

Kify makes automatic direct debit (incasso) easy for businesses: connect the
business's payment account, onboard a customer and obtain consent/a valid mandate,
set up recurring collections, and see what was collected or needs attention.
Reliable activation, collection status, customer communication and clear exception
handling are the core product outcomes. Invoicing and bookkeeping integrations
reduce the administration around that workflow.

Responsibilities:

- **Kify:** the business/customer collection workflow, consent evidence,
  subscription setup and lifecycle, automation, status and follow-up, plus the
  invoices and communications needed for those collections.
- **Mollie:** payment execution and authoritative mandate, subscription and payment
  state. Kify acts on verified provider state and must not invent collection success.
- **Bookkeeping software such as e-Boekhouden:** the accounting administration,
  general ledger, financial statements and tax-return workflows. Kify synchronizes
  the relevant invoice/payment records through tenant-owned integrations and shows
  their synchronization status. It does not replace that accounting product.

Each tenant can issue and deliver invoices supporting its collections without
depending on Mollie Invoicing or e-Boekhouden activation. Kify owns the identity,
immutable data, rendered documents, delivery and history of Kify-issued invoices;
historical provider-owned invoices keep their original ownership. An accounting
connection is optional for a tenant, while reliable bookkeeping integration is an
important supporting product capability.

Tenant business flows remain explicitly tenant-scoped and use each tenant's
Mollie organization without API-key sharing, credential mixing, or implicit
fallback. Normal operators see invoice readiness separately from Mollie payment
readiness.

Prioritize features by whether they make incasso easier to set up, more reliable,
clearer to manage, or less work to administer. Account mappings belong in integration
setup; normal product use should focus on customers, collections and exceptions.
General journal entry, account-plan management, tax returns and general financial
reporting are outside Kify's product scope. Fee/payout integration is considered
only for a concrete collection-administration need, with the bookkeeping provider
remaining the accounting authority. The completed historical repairs were bounded
integration cleanup, not a new ongoing ledger-management feature.

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
owns new invoice issuance and delivery, Mollie remains payment truth, and
e-Boekhouden is optional accounting synchronization. Historical Mollie and
e-Boekhouden invoices continue to use their provider adapters; new Kify
first-payment and recurring issuance freezes canonical data before rendering,
stores private artifacts, and uses a server-side attachment path.

Mollie Connect M1 through M5 are implemented. OAuth connection identity, token
lifecycle, scopes, profile selection, capability state, revocation, reconnect,
and credential-neutral business calls exist. M6 still requires live proof with
a real connected tenant.

## Active Milestone: Kify-Owned Invoicing

This is the only active product milestone.

This milestone supplies the invoice/document part of the incasso workflow; it
does not redefine Kify as a standalone invoicing or bookkeeping product.

Goal: implement and prove Kify-native automated invoicing using the detailed
contract in
[`kify-owned-invoicing-implementation-plan.md`](./kify-owned-invoicing-implementation-plan.md).
Kify will issue new invoices, render Dutch PDFs through a provider-neutral
native PDFKit renderer, store artifacts privately, and preserve existing
delivery, retry, legacy-document, tenant-isolation, and money-flow safeguards.
Kify is the default issuer for new tenants; e-Boekhouden remains an explicit,
tenant-scoped optional issuer after its own credentials and setup validate.

Work through K1 through K8 in order. K1 through K6 are complete; K7 migration
verification and controlled rollout is the current implementation milestone.
The active program is complete only after controlled live-tenant proof and K8
archives the implementation plan and promotes the next roadmap milestone.

### Planned K7 Release Gate: Tenant Readiness

Status: planned; next implementation slice after the existing-tenant receipt
release preparation/activation. A pending genuine transaction can be observed
when due while this preparation proceeds. No additional tenant is live-approved
by the code-level readiness checks alone.

Goal: an independent tenant can complete an assisted setup using its own business
details, payment account and optional accounting connection, with explicit blockers
before live use. Manual workspace/membership provisioning remains acceptable for
this pilot. Self-service signup and broad SaaS administration are later work.

Acceptance:

1. **One end-to-end setup/readiness view.** Cover membership, the intended Mollie
   organization/profile and payment capabilities, invoice issuer, business/customer
   billing details, tax choice, delivery and optional accounting separately. Payment
   readiness must apply even when e-Boekhouden issues invoices. Missing or revoked
   credentials and conflicting organization/profile ownership have actionable,
   tenant-scoped outcomes; the current provider-aware check is not the whole gate.
2. **Tenant-owned policies and customer communication.** Let the tenant review and
   edit terms/privacy URLs, terms version and cancellation contact without silently
   accepting another business's provisioning defaults. Use a suitable Kify platform
   sender or verified tenant identity for customer mail, and show effective delivery
   routing. On 11 November the production project had no recipient override, but
   its shared SMTP sender still identified Ayal Web. Tenant-specific SMTP is optional;
   Ayal Web branding must not be the implicit sender for independent tenants.
3. **Explicit invoice/accounting support.** Kify is the default invoice issuer.
   Its invoices are not currently synchronized to e-Boekhouden by the receipt writer.
   Connecting e-Boekhouden must not imply that unsupported synchronization works.
   Show whether accounting is unconfigured, supported/configured or unavailable for
   the chosen path. An assisted Kify-only pilot does not require accounting sync;
   offering automated bookkeeping for Kify invoices does require that later feature.
4. **Tenant receipt setup and operating limits.** Provide a settings flow for the
   tenant's verified Mollie profile, existing financial clearing account and future
   activation date. Preserve disabled-by-default behavior, credential binding,
   historical exclusion and durable duplicate prevention. Never assume ledger code
   1030 or create financial entries as a readiness probe. Include the accounting-period
   review and single-writer prerequisite. Assess the five-candidate daily batch against
   expected tenant volume, with visible backlog/review states and an adequate capacity
   plan before promising timely automatic accounting. Gross receipts, fees, payouts,
   refunds and partial payments must have clear supported/manual boundaries.
5. **Independent-tenant verification and truthful documentation.** Cover setup,
   failure/reconnect paths and isolation with appropriate automated tests. Before
   independent-tenant go-live, record the controlled real payment, invoice, recipient
   delivery, webhook/recovery and applicable accounting evidence under the K7/M6
   contracts; preserve existing tenants and original documents. Update the tenant
   setup guide to reflect the existing provider connection forms and the new setup
   flow. Neither local tests nor Ayal Web's successful provider reads close this gate.

The K7 implementation contract links to this acceptance scope. The current
provider-aware readiness foundation and implemented receipt safeguards remain
useful; this planned work completes the operator/product setup around them.

### Existing Reliability Work And Deferred Follow-Ups

Automatic subscription activation and cron reliability safeguards are implemented.
Their remaining genuine webhook, delivery and controlled invoice proof stays open.
Use the [invoice runbook](../operations/invoice-automation-runbook.md) and
[invoice reliability reference](../../operations/invoice-reliability.md) for current
procedures. Do not invoke billing merely to test notification delivery.

Independent monitoring, provider-side relationship cleanup, optional bookkeeping
consent and legacy-key retirement remain separately scoped. Preserve the dependency
review and the **17 November 2026** SDK-review checkpoint below. Historical recipient
overrides are not current configuration; check effective routing before tenant use.

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
queue under the current delivery order above while keeping the blocked M6 live
proof visible. Basic tenant policy editing has moved into the planned K7 tenant
readiness gate; do not leave it behind a later general settings project.

- **Ownership clarification completed, 7 November 2026.** The user accepted
  the [platform/merchant model](../integrations/mollie-account-ownership.md).
  Current identity and OAuth live reads are verified; full M6 proof, external
  JHS cleanup and bookkeeping permission design remain open in the current
  review queue above. Do not recreate this as an unresolved account-design task
  or infer that external reconfiguration has been performed.

- **TODO: independent operational monitoring.** Add an external cron heartbeat
  monitor for missing/late runs and hard timeouts, plus actionable runtime-error,
  unresolved billing/recovery, and alert-delivery failure monitoring. Detection
  and notification must still work when Kify or its SMTP service is unavailable;
  the in-app cron summary email alone is not sufficient. Define schedule-aware
  thresholds, tenant/mode context, deduplication, recovery notices, and a short
  response runbook. Route notifications to `info@ayalweb.com` initially; switch
  to `info+kify@ayalweb.com` only after receipt is verified. Acceptance requires
  controlled missed-heartbeat, runtime-failure, and SMTP-outage tests without
  replaying live billing. This is planned work, not implemented monitoring.

- **LOW priority: legacy cron-secret cleanup.** Scheduled execution is now
  verified, but external callers using `INVOICE_CRON_SHARED_SECRET` must be
  inventoried before removing it. Keep `CRON_SECRET` authentication intact;
  removal requires a separate approved configuration/code cleanup. Do not bundle
  it with the webhook URL repair or assume successful runs prove it unused.

- **By 17 November 2026:** verify the installed Mollie Node dependency
  (`@mollie/api-client`, currently 4.5.0) against Mollie's generated
  TypeScript SDK migration guide. If it is still the legacy client, plan and
  execute a tenant-safe migration before the legacy SDK enters maintenance
  mode; do not let this incidental maintenance work interrupt the active Kify
  milestone.

1. provider-side subscription cancellation execution under `subscription-policy.md`
2. controlled refund read/create lifecycle with audit and uncertain-outcome reconciliation
3. chargeback detail and operator follow-up
4. balances and settlements reconciliation for payout/accounting visibility
5. optional e-Boekhouden synchronization for Kify-owned invoices
6. profile and payment-method health improvements beyond the Connect completion gate
7. plan catalog, invoice-line templates, VAT, and revenue-ledger mapping
8. discounts, trials, setup fees, and proration after catalog policy exists
9. customer self-service cancellation and richer entitlement rules
10. per-subscription policy overrides
11. global button contrast and accessibility audit through shared design-system
    tokens; do not apply one-off route-level color fixes
12. broader roles, self-serve tenant administration, invites, and platform billing
13. Application Fees or Resell Pricing after commercial and tax policy is approved
14. low-priority Dutch address lookup for invoice-profile forms; use PDOK as an
    optional assist, keep manual entry available, and do not let lookup failure
    block invoice issuance

Pause/resume remains out of scope while Mollie cancellation is irreversible.
Marketplace, Split Payments, balance transfers, programmatic payouts, Orders,
shipments, and POS remain non-goals until a separate product decision adds them.
