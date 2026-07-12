# Architecture Overview

Status: active reference
Audience: developers

## Purpose

This document describes the current intended implementation shape of the app.
It is not the product backlog. For release target and sequencing, use:

- `../product/multi-tenant-pilot-scope.md`
- `../product/implementation-roadmap.md`

## System Roles

- Mollie: payment collection and mandate source of truth
- Invoice provider truth: each stored invoice belongs to the provider that
  created it (`eboekhouden` or `mollie`)
- e-Boekhouden: bookkeeping integration plus one supported invoice provider
- PostgreSQL: local operational state, sync state, tenant-scoped business data,
  alerts, audit logs, invoice queues, and consent evidence
- App server: authentication, tenant context resolution, onboarding, operator UI,
  reconciliation, webhook processing, protected cron automation, and email
  delivery

## Tenant Context Model

The canonical near-term tenant model is:

- authenticated operator pages keep normal URLs such as `/customers`,
  `/payments`, `/notifications`, and `/settings`
- a signed-in operator may belong to one or more tenants
- one tenant is the current active tenant for the authenticated session/workflow
- all tenant business queries and mutations resolve through the active tenant
- public hosted consent and hosted return routes stay on normal product paths
  and resolve tenant context through the token and linked local state

There is no acceptable implicit app-wide tenant for tenant business flows.

## High-Level Flow

### Operator authentication and tenant access

1. Operator signs in through a supported auth provider.
2. Product authorization checks tenant membership or a controlled
   platform-operator bootstrap path.
3. One tenant becomes the active tenant context.
4. Authenticated app surfaces run inside that tenant context until the operator
   explicitly changes it.

### Subscription onboarding

1. Operator creates or imports a customer inside the active tenant.
2. App creates a tenant-owned Mollie first-payment flow.
3. Customer enters the hosted consent flow.
4. Customer accepts the tenant-owned terms snapshot and proceeds to Mollie
   checkout.
5. Mollie payment and mandate state are synced back into the app inside the
   resolved tenant context.
6. Operator creates the recurring subscription once the first payment and
   mandate are ready.

### Recurring operations

1. Mollie webhooks or manual repair flows trigger sync.
2. The flow resolves tenant context before reading provider credentials or local
   business state.
3. Local state is refreshed from Mollie rather than trusting webhook payloads
   blindly.
4. Alerts and audit logs are written with tenant scope for important transitions
   and failures.
5. Invoice automation uses tenant-scoped local billing rows plus the tenant's
   active invoice provider setting to create invoices, while app-owned delivery
   continues to send and track customer email delivery.

## Main App Surfaces

Primary routes:

- `/`
- `/customers`
- `/payments`
- `/notifications`
- `/settings`
- `/login`
- `/subscribe/[token]`
- `/subscribe/[token]/return`

Legacy redirect routes still exist for compatibility:

- `/alerts` -> `/notifications`
- `/payment-links` -> `/payments`

Authenticated operator routes keep normal product URLs. Tenant context is not
encoded in the path for the pilot.

## Important API Endpoints

- `/api/auth/[...nextauth]`: auth provider and session handler
- `/api/health`: minimal public liveness plus advanced/cron setup, reliability,
  and invoice-automation diagnostics
- `/api/webhooks/mollie`: webhook intake and replayable event storage
- `/api/cron/recurring-invoices`: protected repair, invoice, and delivery
  automation entrypoint
- `/api/eboekhouden/relations`: relation lookup, detail, and linking support

All tenant business endpoints and background entrypoints must resolve tenant
context before touching tenant business data or tenant-owned provider
credentials.

## Code Map

- `auth.ts`: auth provider configuration and session callbacks
- `lib/env.ts`: platform env parsing and readiness checks
- `lib/db.ts`: Drizzle database and pooled PostgreSQL access
- `db/schema.ts`: canonical schema definition
- `lib/mollie/*`: tenant-aware Mollie client resolution and webhook helpers
- `lib/eboekhouden/*`: tenant-aware e-Boekhouden client/session resolution,
  relation linking, invoice creation, reconcile, and retry logic
- `lib/invoicing/*`: provider adapters and active-provider resolution
- `lib/invoices.ts`: provider-neutral stored invoice reads and writes
- `lib/onboarding/*`: onboarding actions and data reads
- `lib/operations/*`: operator actions around subscriptions and workflows
- `lib/reliability/*`: sync, alerts, repairs, and reporting
- `lib/invoice-delivery*.ts`: invoice email delivery and retry logic
- `lib/invoice-pdf.ts`: trusted invoice document URL normalization and
  attachment fetch guardrails

## Data Model Notes

The schema is defined in `db/schema.ts` and migrated through Drizzle.

Required tenant/platform entities:

- `tenants`
- operator membership table or equivalent
- tenant-owned provider credential storage
- `tenant_subscription_policy_defaults`
- `tenant_billing_settings`

Required tenant business entities:

- `customers`
- `mandates`
- `subscriptions`
- `payments`
- `payment_links`
- `subscription_onboarding_consents`
- `recurring_billing_schedules`
- `alerts`
- `audit_logs`
- `webhook_events`
- `customer_notes`
- subscription operation request storage

Tenant business tables should carry `tenant_id` unless a table is explicitly
documented as global-only. Unique constraints and idempotency rules should
include tenant scope where relevant.

## Operational Design Rules

- Persist local state for safety, repair, and auditability.
- Keep Mollie payment truth separate from provider-owned invoice truth.
- Resolve tenant context before provider lookup, business-data query, or
  background follow-up work.
- Use claim-before-upstream-call patterns for invoice creation to prevent
  duplicates.
- Treat webhooks as signals that trigger re-fetch and reconciliation.
- Keep webhook callback URLs secret-free; intake should validate that resources
  resolve to managed local state and a single tenant context.
- Keep test and live mode separation explicit at both env and record level.
- Treat invoice document URLs as hints; only trusted provider document hosts
  should be displayed or fetched.
- Do not fall back to one platform-global Mollie or e-Boekhouden account for a
  tenant business action.
