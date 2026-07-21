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
| Broad SaaS administration | missing | Self-serve signup, invites, platform billing, full role matrix, and tenant SMTP overrides are later work. |

## Mollie Connection

| Capability | Status | Current evidence |
| --- | --- | --- |
| Manual tenant Mollie API-key connection | complete | Provisioning stores mode-specific encrypted tenant API keys; business calls fail closed without them. |
| Mollie Connect OAuth | partial | Authorization, callback, encrypted refresh, revocation, reconnect, profile selection, and OAuth request context are implemented; M6 live connected-tenant proof remains. |
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
| Subscription creation and synchronization | complete | Active onboarding creates Mollie subscriptions and reconciliation refreshes provider state. |
| Subscription operation intent | partial | Durable cancellation requests, policy, operator surfacing, and pre-execution transitions exist; provider cancellation execution does not. |
| Pause/resume | missing | Blocked by product policy because Mollie cancellation is not reversible pause. |

## Payments And Reliability

| Capability | Status | Current evidence |
| --- | --- | --- |
| Payment and payment-link synchronization | complete | Provider state is re-fetched and persisted with explicit tenant context. |
| Managed webhook processing | complete | Payment, subscription, and payment-link intake persists evidence, resolves tenant-local resources, and fails closed when unmanaged. |
| Reconciliation and repair | complete | Protected tenant-aware sync, replay, targeted repair, and stale follow-up paths exist. |
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
| e-Boekhouden invoicing | complete | Tenant credentials, relation links, invoice settings, creation, reconciliation, and documents exist. |
| Mollie Sales Invoices | partial | Adapter and readiness probe exist; live use still depends on Mollie Invoicing activation for each tenant organization. |
| Kify-owned invoicing | partial | K1-K5 exist: canonical tenant/customer billing data and exact VAT-inclusive cents validation; native PDFKit rendering; deterministic private Blob artifacts; automated first-payment and recurring issuance with frozen retry; private server-side email attachment. K6 routes Kify history/download/resend through tenant-fenced canonical invoice IDs, private document service, and canonical invoice numbers while preserving sanitized legacy URLs; tenant readiness validates Kify’s issuer profile without requiring Mollie Invoicing. Profile-editing UX and controlled rollout remain pending. See `kify-owned-invoicing-implementation-plan.md`. |
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

The active goal is Kify-owned invoicing. Start from `implementation-roadmap.md`
and execute `kify-owned-invoicing-implementation-plan.md` in milestone order.
Mollie Connect M6 live proof remains an explicit external blocker. Do not select
other work from missing rows in this inventory unless the roadmap promotes it.
