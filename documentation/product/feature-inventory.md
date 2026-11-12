# Feature Inventory

Status: active capability evidence
Audience: product and engineering

## Purpose

This file records current product capability. It does not define development
order. Use `implementation-roadmap.md` for sequencing and the active milestone.

Statuses:

- `complete`: current documented scope exists and is verified in code
- `partial`: useful foundation exists, but named behavior is missing
- `missing`: capability does not exist
- `blocked`: code exists, but an external dependency prevents live use

## Platform And Tenant Foundation

| Capability | Status | Current evidence |
| --- | --- | --- |
| Membership-led product access | complete | Dashboard access requires tenant membership or controlled platform-operator bootstrap access. |
| Active tenant selection | complete | Authenticated operator flows resolve one selected tenant through shared tenant context. |
| Tenant-scoped business data | complete | Customer, mandate, subscription, payment, schedule, payment-link, consent, note, alert, invoice, webhook, and settings paths are tenant-fenced on verified business seams. |
| Tenant-owned provider credentials | complete | Mollie API keys and e-Boekhouden credentials are encrypted and resolved with explicit tenant context. |
| Tenant subscription-policy settings UI | missing | Defaults are tenant-owned but still seeded during provisioning and lack a normal edit surface. |
| Complete tenant readiness and assisted setup | partial | Provider connections/settings and provider-aware probes exist. The roadmap now plans complete setup checks, editable policies, suitable mail identity, explicit accounting support, receipt capacity and independent-tenant proof under K7. This is not yet self-service onboarding or live approval. |
| Broad SaaS administration | missing | Self-serve signup, invites, platform billing, full role matrix, and tenant SMTP overrides are later work. |

## Mollie Connection

| Capability | Status | Current evidence |
| --- | --- | --- |
| Manual tenant Mollie API-key connection | complete | Provisioning stores mode-specific encrypted tenant keys; this path is used only when no OAuth connection row exists. OAuth failure never falls back to a key. |
| Mollie Connect OAuth | partial | Authorization, callback, encrypted refresh, revocation, reconnect, profile selection, and OAuth request context are implemented; M6 live connected-tenant proof remains. |
| Optional Mollie bookkeeping access | partial | Preserved separately in the shared workspace: a local consent upgrade and bookkeeping read checks. This receipt branch excludes that OAuth/schema work. Deployment and live reauthorization remain; no accounting writes are implemented by that feature. |
| Ayal Web OAuth identity and live read access | complete | 7 November: existing OAuth token read the owning organization, selected Ayal Web profile and an existing paid live payment. Normal resolver selects OAuth despite the retained key. This bounded check does not close M6. See `../integrations/mollie-account-ownership.md`. |
| Credential-neutral tenant Mollie client | complete | All tenant Mollie SDK and Sales Invoices requests resolve OAuth or temporary tenant API-key authentication through one fail-closed boundary. |
| Provider-aware tenant readiness | complete | Tenant readiness checks the selected invoice provider and performs live provider probes where required. |
| Mollie organization/profile capability UX | complete | Settings provides tenant-scoped connect/reconnect/disconnect, automatic selection of exactly one server-verified profile, explicit selection when multiple profiles exist, and sanitized organization/capability readiness. |

## Customer And Subscription Billing

| Capability | Status | Current evidence |
| --- | --- | --- |
| Mollie customer creation and linking | complete | Tenant-scoped onboarding creates or links managed Mollie customers. |
| Hosted subscription consent | complete | Customers see app-hosted terms before Mollie checkout; consent evidence is stored. |
| First-payment and mandate-only onboarding | complete | Payment-link onboarding supports subscription activation and EUR 0.01 mandate-only setup without normal invoice creation. |
| Mandate synchronization | complete | Managed customer mandates are fetched and stored tenant-locally. |
| Subscription creation and synchronization | complete | Paid first-payment onboarding automatically creates Mollie subscriptions for real-installment and mandate-only flows; reconciliation refreshes provider state and bounded recovery escalates only exhausted failures. |
| Subscription operation intent | partial | Durable cancellation requests, policy, operator surfacing, and pre-execution transitions exist; provider cancellation execution does not. |
| Pause/resume | missing | Blocked by product policy because Mollie cancellation is not reversible pause. |

## Payments And Reliability

| Capability | Status | Current evidence |
| --- | --- | --- |
| Payment and payment-link synchronization | complete | Provider state is re-fetched and persisted with explicit tenant context. |
| Managed webhook processing | complete | Payment, subscription, and payment-link intake persists evidence, resolves tenant-local resources, and fails closed when unmanaged. |
| Reconciliation and repair | complete | Protected tenant-aware sync, replay, targeted repair, and stale follow-up paths exist. |
| Repair batch outcome reporting | complete | Empty batches and deliberate stale-target skips are successful no-ops; caught failures remain counted separately and mark the batch audit as failed even when other targets recover. Failure counts remain included in skipped totals for compatibility. |
| Failed-payment correctness | complete | Failed, reversed, charged-back, mandate-problem, and unsafe-pending states are classified from reconciled Mollie truth. |
| Failed-payment customer notification | complete | Claim-before-send persistence, bounded retry, audit-safe evidence, and operator alerts exist. |
| Automated dunning or service consequences | missing | Pause, cancellation, fees, collection, and penalties remain manual by policy. |
| Refund operations | missing | Refund creation and dedicated refund lifecycle storage/UI are not implemented. |
| Chargeback operations | partial | Payment classification detects chargeback state; no dedicated chargeback detail/workspace exists. |
| Balances and settlements reconciliation | missing | No Mollie balance or settlement ingestion exists. |

## Invoicing And Accounting

| Capability | Status | Current evidence |
| --- | --- | --- |
| Provider-neutral invoice ownership | complete | Stored invoices retain the provider that created them; provider switching affects new invoices only. |
| First-payment and recurring invoice creation | complete | Provider adapters create invoices with tenant context and duplicate-prevention claims. |
| Kify first-payment cron dispatch | complete | First-payment batches bypass legacy adapter setup for Kify and retain tenant-scoped Kify issuer validation; legacy providers still require their setup checks. Focused local regression coverage exists; deployed cron proof remains pending. |
| e-Boekhouden invoicing | complete | Tenant credentials, relation links, invoice settings, creation, reconciliation, and documents exist. |
| e-Boekhouden sales posting | partial | Production includes and verifies the sales mutation while retaining original invoice dates. Historical repairs are complete; the first naturally due combined invoice/posting proof remains open. |
| e-Boekhouden customer-payment posting | partial | Future-only tenant mapping/cutover, immutable claims, one-attempt transport, reconciliation and daily cron are implemented and tested. See the receipt runbook and release record for migration/activation state; first genuine automatic receipt proof remains open. |
| Mollie fee/payout accounting | missing | No fee-invoice, balance or settlement ingestion/posting; bookkeeping OAuth read scopes are absent. See `../operations/connect-and-bookkeeping-review-2026-11-07.md`. |
| KOR and invoice verification | partial | Explicit tenant KOR/standard treatment, inclusive-price requests, per-invoice API identity/total/VAT checks, frozen delivery verification and duplicate safeguards are implemented. Provider PDFs are visually reviewed at setup and template/tax changes; routine delivery has no PDF text parser or byte-hash gate. The e-Boekhouden posting release and ten reviewed historical sales corrections are complete; its first real combined issuance proof and the Kify-native rollout remain pending. |
| Mollie Sales Invoices | partial | Adapter and readiness probe exist; live use still depends on Mollie Invoicing activation for each tenant organization. |
| Kify-owned invoicing | partial | K1-K6 exist: canonical tenant/customer billing data and exact VAT-inclusive cents validation; native PDFKit rendering; deterministic private Blob artifacts; automated first-payment and recurring issuance with frozen retry; private server-side email attachment; tenant-fenced history, resend, download, payment detail, readiness, and future-only profile editing. Kify is the default for new tenants; completed e-Boekhouden tenants may explicitly choose it for new invoices. Controlled rollout remains pending. See `kify-owned-invoicing-implementation-plan.md`. |
| Invoice delivery, resend, and download | complete | Tenant-scoped delivery evidence, retry, customer invoice links, manual resend, and trusted document fetch exist. |
| Plan catalog and accounting mappings | missing | Plans, reusable line templates, VAT, discounts, trials, setup fees, proration, and per-plan ledger mapping are later work. |

## Operator Product

| Capability | Status | Current evidence |
| --- | --- | --- |
| Needs Attention | complete | Normal surfaces show stable, prioritized payment, invoice, setup, sync, webhook, mandate, and pending-cancellation items without raw payloads. |
| Customer timeline and notes | complete | Sanitized activity, derived lifecycle state, notification history, and typed customer notes exist. |
| Advanced reliability controls | complete | Auth-gated health, reconciliation, replay, repair, invoice retry, and cron evidence share tenant-aware reliability data. |
| Retention visibility and dry-run | complete | Typed policy, inventory, and aggregate dry-run reporting exist; no destructive apply path exists. |
| Customer self-service cancellation | missing | Cancellation intake is operator-led; customer self-service remains later work. |

## Current Development Pointer

Kify's product goal is easy automatic incasso. Kify-owned invoicing is the active
supporting milestone, with the receipt rollout and planned tenant-readiness gate
ordered by `implementation-roadmap.md`. Use the Kify implementation plan for its
K7/K8 acceptance contract; code completion and live proof remain distinct.
Mollie Connect M6 live proof remains an explicit external blocker. Do not select
other work from missing rows in this inventory unless the roadmap promotes it.
