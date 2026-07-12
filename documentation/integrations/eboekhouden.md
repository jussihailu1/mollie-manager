# e-Boekhouden Integration

Status: active reference
Audience: developers

## Role

e-Boekhouden is one supported invoice provider plus the bookkeeping integration
for tenants that use it.

The app uses e-Boekhouden for:

- customer relation lookup and linking
- invoice template discovery
- revenue-ledger discovery
- first-payment invoice creation
- recurring invoice creation
- invoice reconciliation

For the shared multi-tenant pilot, each tenant owns its own e-Boekhouden
credentials/session context. Tenant business flows must not rely on one shared
app-wide e-Boekhouden token.

## Authentication Model

- current tenant business flows resolve tenant-owned e-Boekhouden credentials
  before starting a session
- `EBOEKHOUDEN_API_SOURCE` is sent with the session request
- session tokens are cached in memory and renewed when needed
- session cache is tenant-aware
- tenant business flows fail closed without explicit tenant context

Main implementation:

- `lib/eboekhouden/client.ts`

## Customer Relation Linking

- Operators can search and import relations from e-Boekhouden
- Local provider links now live in `customer_accounting_links`, keyed by
  tenant, customer, mode, and provider
- Linking is mode-aware and prevents duplicate local linking in the same mode
- Linking must run against the active tenant's e-Boekhouden account and must not
  mix relations across tenants

## Invoice Model

- The provider that created an invoice owns invoice truth for that stored
  invoice row
- The app owns invoice delivery behavior when configured for SMTP delivery
- The app must not rely on e-Boekhouden to email customers in the normal app-owned delivery path

Current invoice areas:

- stored invoices now live in the provider-neutral `invoices` table
- e-Boekhouden-only invoice defaults live in `tenant_eboekhouden_invoice_settings`
- tenant-wide generic invoice defaults, including the explicit active provider,
  live in `tenant_billing_settings`

Invoice template discovery, revenue-ledger discovery, invoice creation, and
invoice reconciliation must all run against the active tenant's e-Boekhouden
company/account.

## Safety Rules

- Claim rows before calling the upstream invoice API
- Store returned provider invoice id and number in the provider-neutral invoice table on success
- Write audit logs for success and failure
- Open operator alerts for important failures
- Do not treat `mandate_only` EUR 0.01 flows as normal recurring invoice events
- Resolve tenant context before relation lookup, relation linking, template
  discovery, ledger discovery, invoice creation, invoice retry, reconciliation,
  or PDF URL trust decisions
- there is no supported global e-Boekhouden token path for tenant business
  flows; credentials must be stored per tenant

## Relevant Files

- `lib/eboekhouden/client.ts`
- `lib/eboekhouden/relation-mapping.ts`
- `lib/eboekhouden/first-payment-invoices.ts`
- `lib/eboekhouden/recurring-invoices.ts`
- `lib/invoice-delivery.ts`
- `app/api/eboekhouden/relations/*`

## Relevant Env

- `INVOICE_EMAIL_OVERRIDE_TO`
- SMTP env values used by app-owned delivery

Tenant e-Boekhouden credentials now live in tenant storage, not global env.
The session source value is stored with those tenant credentials.
