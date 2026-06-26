Status: canonical scope
Audience: product and engineering

## Purpose

This document defines the near-term release target for the product: a shared-app,
manually provisioned multi-tenant pilot.

Use this file when a roadmap or implementation decision depends on what "multi-tenant
pilot" means. This file is not a broad SaaS vision document. It defines the smallest
acceptable shared-app tenant model that still preserves money-flow correctness,
operator safety, and auditability.

## Pilot Goal

The near-term goal is a shared app that can be used by multiple tenant businesses
without cross-tenant data leakage, credential mixing, or ambiguous operator access.

The pilot must still preserve the existing product direction:

- Mollie remains the payment and mandate source of truth
- e-Boekhouden remains the invoice and accounting source of truth
- no duplicate invoice may be created for one billing period
- normal operators should use guided workflows, not raw provider internals
- destructive or high-risk lifecycle automation remains explicit, manual, or
  separately policy-gated

## In Scope

The multi-tenant pilot must support:

- one shared deployed app
- multiple tenants in one product environment
- manually created tenants
- manually created operator membership per tenant
- Google sign-in as one supported authentication provider
- normal authenticated app URLs such as `/customers`, `/payments`,
  `/notifications`, and `/settings`
- session-selected current tenant context for authenticated operator work
- tenant-owned Mollie credentials
- tenant-owned e-Boekhouden credentials
- tenant-owned subscription policy defaults
- tenant-owned billing/accounting settings
- tenant-safe webhook, replay, repair, sync, cron, onboarding, invoice, and
  notification flows
- focused tests proving tenant isolation

## Explicit Non-Goals For This Pilot

The multi-tenant pilot does not require:

- self-serve tenant signup
- invite workflows
- platform billing
- public tenant admin onboarding
- subdomain-based tenant routing
- full RBAC with many business roles
- tenant-specific SMTP credentials or sender branding
- provider OAuth/link flows for Mollie or e-Boekhouden
- a customer self-serve subscription portal

These remain later-stage product work.

## Tenant Context Model

The canonical MVP tenant model is:

- authenticated operator pages keep normal URLs such as `/customers`,
  `/payments`, `/notifications`, and `/settings`
- a signed-in operator may belong to one or more tenants
- one tenant is the current active tenant for the session
- all authenticated tenant business queries and mutations must resolve against
  the current active tenant
- changing tenant is a protected session/context change, not a route-namespace
  requirement
- public hosted consent and hosted return routes stay on normal product paths
  and resolve tenant context through the onboarding token and linked local state

No tenant business flow may rely on an implicit app-wide tenant.

## Authentication And Authorization Model

Authentication and authorization must stay separate.

Authentication for the pilot:

- Google sign-in is the current supported provider
- future providers may be added later without changing tenant business policy

Authorization for the pilot:

- signing in is not enough by itself
- app access requires either a tenant membership or an explicit platform-operator
  record used for controlled administration/bootstrap work
- normal operator actions run inside one active tenant context
- `AUTH_ADVANCED_EMAILS` may continue to gate advanced technical controls, but it
  does not create product access on its own and does not bypass tenant context
- developer mode toggle remains presentation-only and never grants access by itself

## Provider Ownership

Provider ownership for the pilot is:

- each tenant owns its own Mollie credentials/configuration
- each tenant owns its own e-Boekhouden credentials/configuration
- platform SMTP may remain shared for the pilot
- future tenant-specific SMTP overrides remain later scope

Current global env-backed provider credentials are implementation debt that must
be replaced before the shared multi-tenant pilot is considered ready.

## Tenant-Owned Product Defaults

The following are tenant-owned defaults in the pilot:

- cancellation contact email
- terms URL
- privacy URL
- terms version
- default cancellation effect
- invoice template selection
- revenue ledger selection
- VAT/invoice accounting defaults

Past customer consent must remain tied to the exact tenant-owned terms shown at
acceptance time. Future tenant default changes must not silently rewrite past
consent meaning.

## Data Model And Isolation Rules

The pilot must treat tenant isolation as a first-class product invariant.

Required rules:

- tenant business data must be tenant-scoped
- business tables must carry `tenant_id` unless a table is explicitly documented
  as global-only
- unique constraints and idempotency rules must include tenant scope where
  relevant
- audit logs, alerts, customer notes, onboarding consents, schedules, operation
  requests, and webhook events must not leak across tenants
- webhook processing, replay, repair, cron, and sync flows must resolve tenant
  before reading or mutating tenant business data
- no background flow may fall back to a platform-global provider account for a
  tenant business action

## Manual Tenant Provisioning

Manual tenant onboarding is the canonical pilot path.

The expected operator/platform flow is:

1. create tenant
2. create at least one operator membership for that tenant
3. store tenant Mollie credentials/configuration
4. store tenant e-Boekhouden credentials/configuration
5. configure tenant billing/accounting settings
6. configure tenant subscription policy defaults
7. verify tenant-safe public webhook and app URL assumptions
8. run readiness checks in that tenant context before live customer usage

No self-serve tenant creation or invite flow is required for the pilot.

## Release Gates

The shared multi-tenant pilot is not ready until all of the following are true:

- no normal operator surface can read another tenant's customers, payments,
  subscriptions, notes, alerts, invoices, or settings
- tenant-owned provider credentials are used consistently in business flows
- webhook and cron follow-up cannot act without resolved tenant context
- current money-flow safeguards still hold after tenant scoping
- focused tests cover tenant isolation at query, mutation, and external-service
  seam boundaries

## Relationship To Later SaaS Work

This pilot is a foundation step, not the complete SaaS platform.

Later work still includes:

- self-serve signup
- invites
- broader tenant administration UX
- platform billing
- richer roles and permissions
- tenant SMTP overrides
- easier provider account linking flows
