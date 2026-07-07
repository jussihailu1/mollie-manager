# Multi-Tenant Pilot Readiness Review

Status: active working note
Audience: product and engineering

## Good Enough For The Pilot

- tenant membership and platform-operator access gating are in place for normal
  dashboard entry and tenant selection
- normal operator surfaces are fenced to the active tenant
- active tenant business seams now use tenant-owned Mollie and e-Boekhouden
  credentials instead of app-wide fallback
- webhook and cron follow-up require resolved tenant context on the verified
  pilot seams
- focused tenant-isolation release-gate tests exist, and current repo
  verification passes:
  - `npm run test:node`
  - `npm run typecheck`
  - `npm run lint`
  - `npm run build`

## Solve Before Live Use If This Applies To Your Tenants

- tenant subscription-policy defaults are seeded from env during provisioning
  and are not currently editable through a normal tenant UI
  - affected values include cancellation email, terms URL, privacy URL, and
    terms version
  - if pilot tenants need different legal/contact defaults, do not onboard live
    customers until there is a controlled way to set those values correctly per
    tenant

## Fix Soon Because It Can Mislead Operators

- `scripts/invoice-automation-readiness.mjs` still checks app-wide env such as
  `EBOEKHOUDEN_API_TOKEN` and `MOLLIE_DEFAULT_MODE` instead of tenant-owned
  stored credentials
  - that makes it a poor tenant go-live gate in the multi-tenant pilot
- `/api/health` still reports setup status from app-wide env checks such as
  global Mollie configuration, even though tenant business flows now use
  tenant-owned credentials
  - useful for platform/runtime diagnostics
  - not sufficient by itself as a tenant readiness decision

## Fine For The Pilot, But Operationally Rough

- tenant provider credentials are managed through `npm run tenant:provision`
  instead of a normal UI
- tenant billing/accounting settings have a UI, but tenant credential rotation
  and tenant subscription-policy default edits do not
- there is no dedicated tenant-specific readiness command that checks:
  - tenant membership
  - tenant-owned provider credentials
  - billing/accounting completeness
  - live/test mode coverage
  - first-customer smoke readiness

## Likely Later Risk

- `legacy-default` bootstrap baggage still exists in schema/runtime helpers as
  migration compatibility
- some setup and integration docs were written during the env-backed phase and
  need continued cleanup when pilot work settles
- cron currently fans out across all tenants in one run, which is acceptable for
  a small pilot but may need tighter tenant targeting and failure isolation
  later
