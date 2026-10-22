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

### Active Correctness Slice: Automatic Subscription Activation

A user-reported paid-first-installment activation failure is being corrected as
a bounded money-flow reliability slice alongside K7. Paid real-installment and
mandate-only onboarding use server-owned activation; Mollie's webhook retry
window provides recovery without a higher-frequency platform scheduler, and
tenant/customer notifications remain tenant-scoped. Controlled test and live
proof remain required.

### Active Correctness Slice: Cron Reliability

The bounded cron correctness slice under K7 is tracked in
[`TEMP-billing-recovery-roadmap.md`, step 4](../operations/TEMP-billing-recovery-roadmap.md).
It corrects Kify first-payment routing and empty/partial failure reporting, and
adds consolidated operator notifications without replaying billing on alert
failure. Local validation and release evidence are recorded in the
[cron release procedure](../operations/cron-reliability-release-2026-10-08.md).
Commit `1179c82` is deployed and release health/configuration checks passed on
8 October 2026. The 22 October read-only check verified daily completion through
22 October; operator notification inbox receipt remains unproven. Both existing
live Mollie subscription webhook URLs were corrected on 22 October and verified
with provider GETs; genuine webhook receipt/processing remains unproven. See
[current health findings and decision log](../operations/production-health-and-followups-2026-10-22.md).
Additional Cloudflare sync-only recovery is optional: first verify the webhook
flow and scheduled daily cron. If daily fallback latency is unacceptable, start
a separate bounded job every two hours and measure usage before increasing its
frequency. See step 5 of the temporary roadmap for the decision and estimate.
The full billing cron stays daily. Independent monitoring and Mollie Connect
ownership remain separate backlog items.

### Immediate Maintenance And Operational Follow-Up — 22 October 2026

These are correctness and readiness follow-ups, not additional product milestones.

- **Subscription webhook URL repair complete; genuine delivery proof open.**
  On 22 October both active live Ayal Web subscriptions were patched only to
  `https://kify.app/api/webhooks/mollie`, without legacy secret query parameters.
  Provider GETs verified all other fields unchanged; all 33 database tables and
  seven historical provider payments were unchanged. Encrypted rollback is
  retained outside Git. Observe the next genuine tenant-scoped webhook and
  successful processing; no replay, billing, email, or deployment test.
  Three managed live payment links also retain legacy destinations (one Vercel,
  two ngrok). Follow-up provider inspection confirmed all three were already paid
  in April and are single-use; retain these historical records unchanged. Their
  new-payment repair follow-up is closed; payment-link webhook URL updates are
  not documented by Mollie. New onboarding links already use the configured URL.
  Exact IDs and evidence are in the current health handoff. The user subsequently
  authorized local documentation checkpoints and the issue 4 review below;
  push and deployment remain unauthorized.
- **Dependency-security fixes validated locally; release not authorized.**
  User authorized implementation and separate local dependency/UI commits.
  `3c263b9` updates Next.js/eslint-config-next to 16.4.2 and ip-address to 10.7.4.
  The separate UI/test changes resolve effect/state lint errors and restore
  lifecycle explanations, with cancellation and repair-throttle coverage.
  Clean install, build, typecheck, loopback SMTP and eight local auth/access
  checks pass. Full suite: 518/518; lint: zero errors/warnings; production audit:
  zero findings. Full audit retains 13 development-only entries (9 high,
  4 moderate) in the braces and drizzle-kit loader chains. Original implementation
  `4cb19ed` and these follow-ups remain undeployed; production is unchanged.
  The app mailer uses an npm alias to keep it independent from NextAuth v5's
  unused optional email-login peer; Google OAuth stays on v5. Full development
  dependency findings remain separately documented. See the
  [22 October fixes and validation](../operations/security-dependency-fixes-2026-10-22.md)
  for validation, limitations and the remaining production release gate. Do not
  use `npm audit fix --force` or downgrade authentication to silence audit output.
- **Scheduled cron execution verified through 22 October.** All 15 daily
  completion audits succeeded; all 14 post-deployment runs completed all 13 stages.
  No overdue live invoice backlog. No issue emails were attempted, as no issues
  were recorded after deployment. A separately approved operator-only delivery
  check and inbox confirmation remain open; never invoke billing to test email.
- **Invoice email routing is intentional and correct.** On 8 October the user
  confirmed that `INVOICE_EMAIL_OVERRIDE_TO=info@ayalweb.com` must remain active.
  Successful delivery records refer to operator delivery under that override;
  this is the accepted workflow, not an outstanding defect or configuration TODO.
  Do not remove the override or resend invoices to customers without a later
  explicit change request.

Independent missed-run monitoring remains an important reliability follow-up.
K7 controlled Kify-native invoice proof remains a gate before broader rollout;
it is separate from the waived e-Boekhouden KOR test. Faster Cloudflare recovery
and Connect ownership design remain later work.

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

- **TODO: clarify Kify platform ownership and AYAL's own tenant in Mollie Connect.**
  Requested on 8 October 2026 as a later design task, after current billing and
  recovery flows work correctly. Document the distinction between the Mollie
  organization that owns Kify's OAuth application, AYAL as a merchant tenant
  collecting payments from its own customers, other merchants connecting their
  own organizations, and any future fees/subscriptions charged for using Kify.
  Confirm with Mollie's supported configuration whether the app-owning
  organization can also connect as AYAL's tenant, and whether separate profiles
  or organizations are appropriate; do not assume a second account is required
  or that self-connection is already proven. AYAL's ordinary customers are not
  automatically Kify tenants. Preserve tenant-owned credentials, payment
  ownership and settlement; AYAL must not become a global payment-account
  fallback for other tenants. Record the final organization/profile mapping,
  onboarding and M6 proof requirements before changing the working setup.
  No Connect/account reconfiguration is authorized by this backlog item.

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
7. tenant subscription-policy settings UI
8. plan catalog, invoice-line templates, VAT, and revenue-ledger mapping
9. discounts, trials, setup fees, and proration after catalog policy exists
10. customer self-service cancellation and richer entitlement rules
11. per-subscription policy overrides
12. global button contrast and accessibility audit through shared design-system
    tokens; do not apply one-off route-level color fixes
13. broader roles, self-serve tenant administration, invites, and platform billing
14. Application Fees or Resell Pricing after commercial and tax policy is approved
15. low-priority Dutch address lookup for invoice-profile forms; use PDOK as an
    optional assist, keep manual entry available, and do not let lookup failure
    block invoice issuance

Pause/resume remains out of scope while Mollie cancellation is irreversible.
Marketplace, Split Payments, balance transfers, programmatic payouts, Orders,
shipments, and POS remain non-goals until a separate product decision adds them.
