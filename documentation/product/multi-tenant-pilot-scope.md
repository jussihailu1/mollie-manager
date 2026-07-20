# Multi-Tenant Pilot Scope

Status: accepted baseline
Audience: product and engineering

## Purpose

This document defines the tenant-isolation and operating baseline established
for the manually provisioned shared-app pilot. It does not set current feature
order. Use `implementation-roadmap.md` for active development sequencing.

## Pilot Outcome

Multiple tenants can use one deployment without cross-tenant data leakage,
provider credential mixing, or ambiguous operator access.

The pilot baseline uses:

- one shared application deployment and database
- manual tenant and operator provisioning
- membership-led access with one active tenant per operator workflow
- tenant-owned Mollie and e-Boekhouden credentials
- tenant-owned subscription-policy and billing/accounting settings
- Mollie as payment and mandate truth
- provider-owned invoice truth per stored invoice
- guided normal operator surfaces with advanced controls kept separate

## Implemented Baseline

- tenant, operator membership, and controlled platform-operator bootstrap models
- active-tenant selection for authenticated operator workflows
- tenant-scoped core business tables, indexes, uniqueness, queries, audits, and UI
- explicit tenant context through onboarding, billing, invoices, sync, webhooks,
  reconciliation, repair, cron, notifications, and customer activity
- encrypted tenant-owned Mollie API keys and e-Boekhouden credentials
- tenant-owned billing settings and subscription-policy defaults
- provider-neutral invoice records and explicit active invoice provider
- tenant-aware provisioning, readiness, health, and operational runbooks
- focused tenant-isolation coverage on release-gate business seams

## Access Model

- Signing in alone does not grant product access.
- Normal access requires tenant membership.
- A platform operator may bootstrap or support tenant access only through the
  controlled platform-operator path.
- One tenant is active for an authenticated operator workflow at a time.
- Developer mode changes presentation only; it never grants access.
- Advanced access never bypasses membership or tenant context.
- Public consent and return routes derive tenant context from protected token
  and linked local state, not from a user-supplied tenant selector.

## Provider Ownership

- Each tenant owns its Mollie connection and configuration.
- Each tenant owns its e-Boekhouden connection and configuration.
- Tenant business flows fail closed when their provider credentials are absent
  or invalid.
- No tenant business flow may use another tenant or a platform-global provider account.
- Shared platform SMTP is acceptable for this baseline; tenant-specific sender
  credentials and branding remain later work.

Mollie Connect OAuth foundations and existing-flow migration are implemented;
manual API keys remain temporary compatibility while M6 live proof is
externally blocked. Kify-owned invoicing is the active product milestone in
`implementation-roadmap.md`. Neither change weakens or reinterprets the
already-completed tenant-isolation baseline in this document.

## Tenant-Owned Settings

Tenant-owned configuration includes:

- subscription terms version
- terms and privacy URLs
- cancellation contact and policy text
- recurring invoice notice timing
- automatic collection enablement and collection timing
- mandate-only setup behavior
- active invoice provider
- provider-specific invoice settings

Subscription-policy defaults currently exist per tenant but are seeded during
manual provisioning. A normal settings UI for those values remains missing and
must be handled as an explicit controlled setup check for tenants whose legal or
contact defaults differ.

## Isolation Rules

- Every tenant business table must carry or derive explicit tenant ownership.
- Tenant-local uniqueness must include tenant identity where provider IDs or
  business keys may repeat across accounts.
- Every business query and mutation must resolve tenant context before access.
- Webhook evidence may be stored before managed context is known, but business
  follow-up must stop unless a tenant-owned local resource resolves.
- Cron and reconciliation may fan out across tenants only by invoking isolated
  tenant-scoped work units.
- Repair, replay, cleanup, notification, and invoice follow-up must preserve the
  same tenant boundary as the original business event.
- Secrets and raw provider payloads must not appear in normal operator output.
- Test and live provider state must remain distinguishable.

## Manual Provisioning Baseline

The existing operator path remains valid during OAuth migration:

1. create tenant and initial membership
2. seed tenant subscription-policy and billing defaults
3. store tenant provider credentials
4. select and configure the active invoice provider
5. run tenant readiness
6. verify legal/contact defaults
7. perform a controlled first-customer smoke test before live onboarding

Use `../operations/tenant-setup-guide.md` for commands and operating steps.

## Baseline Acceptance Gates

- signing in without membership grants no tenant data access
- switching tenants changes every normal business view consistently
- tenant provider credentials are used for all tenant business calls
- no tenantless or global provider fallback exists in business flows
- webhook and cron follow-up cannot continue without resolved tenant context
- cross-tenant reads and writes are covered on core money-flow seams
- failed-payment and duplicate-invoice safeguards survive tenant scoping
- each live tenant passes provider-aware readiness and controlled smoke checks

These gates remain mandatory acceptance checks during Mollie Connect work.

## Non-Goals

- self-serve tenant signup or deletion
- tenant invites and broad membership administration
- full admin, finance, support, developer, and auditor role matrix
- platform subscription billing
- tenant-specific SMTP credentials or sender branding
- platform-wide impersonation
- Marketplace, Split Payments, balance transfers, or multi-seller checkout
- route namespacing by tenant slug

Future work may add these only through `implementation-roadmap.md`.
