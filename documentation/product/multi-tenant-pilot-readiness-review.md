# Multi-Tenant Pilot Readiness Review

Status: active readiness summary; reviewed 12 November 2026
Audience: product and engineering

The [roadmap](implementation-roadmap.md#planned-k7-release-gate-tenant-readiness)
defines the planned complete gate. Kify is an incasso product with an assisted
tenant setup today. This summary does not approve a new tenant for live use.

## Implemented Foundation

- tenant membership and platform-operator access gating are in place for normal
  dashboard entry and tenant selection
- normal operator surfaces are fenced to the active tenant
- active tenant business seams now use tenant-owned Mollie and e-Boekhouden
  credentials instead of app-wide fallback
- webhook and cron follow-up require resolved tenant context on the verified
  pilot seams
- focused tenant-isolation release-gate tests exist; the receipt implementation's
  recorded validation is 796 Node tests, TypeScript, ESLint and build passing
  (synthetic providers, no production financial calls)

## Solve Before Live Use If This Applies To Your Tenants

- tenant subscription-policy defaults are seeded from env during provisioning
  and are not currently editable through a normal tenant UI
  - affected values include cancellation email, terms URL, privacy URL, and
    terms version
  - if pilot tenants need different legal/contact defaults, do not onboard live
    customers until there is a controlled way to set those values correctly per
    tenant

## Fixed In Current Repo State

- `npm run ops:invoice-readiness` is now explicitly platform-only
  - it checks app URL, cron auth, SMTP, and scheduler wiring
  - it no longer expects a global e-Boekhouden token or default tenant mode
- `npm run tenant:readiness -- --tenant-id <tenant-id>` now checks tenant-owned
  live readiness directly
  - tenant row exists
  - one active invoice provider is selected for new invoices
  - only the active provider is treated as required
  - `Kify`, the new-tenant default, checks business invoice profile and tax choice
  - `Mollie` readiness includes a read-only Sales Invoices API probe, so it
    fails clearly until Mollie Invoicing is activated in the Mollie Dashboard
  - `e-Boekhouden` readiness still requires tenant credentials plus invoice
    template and revenue ledger
  - billing/accounting settings are complete for the active provider
  - tenant subscription-policy defaults exist
- the command does not establish the full incasso/delivery/accounting readiness
  gate; payment capability checks for e-Boekhouden issuers, policy correctness,
  mail routing/identity and receipt activation require separate review
- `/api/health` now keeps platform diagnostics separate from tenant diagnostics
  - unauthenticated `/api/health` exposes minimal liveness only
  - authorized advanced/cron diagnostics expose platform details;
    `?tenantId=<tenant-id>` adds tenant readiness and reliability details

## Pending Tenant Readiness

- tenant/membership provisioning is manual; Settings already provides Mollie
  OAuth/profile controls, e-Boekhouden credential updates and invoice profiles
- tenant policy edits still need a normal UI and explicit value review
- the shared SMTP sender identifies Ayal Web in the 11 November production
  project snapshot; independent tenants need suitable sender identity
- receipt mapping remains CLI-only and activation is pending; the five-candidate
  daily limit needs a tenant-volume check, with clear backlog/review visibility
- Kify-issued invoice synchronization is missing; connecting e-Boekhouden must
  not imply the receipt writer supports that path
- full independent-tenant incasso, Kify invoice/delivery and applicable accounting
  proof remains open under K7/M6; production success for Ayal Web is not that proof

## Likely Later Risk

- `legacy-default` bootstrap baggage still exists in schema/runtime helpers as
  migration compatibility
- cron fans out over tenants with isolated failures; aggregate execution time and
  receipt throughput still need checking for larger tenant volumes
