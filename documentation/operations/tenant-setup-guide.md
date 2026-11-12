# Tenant Setup Guide

Status: active reference
Audience: platform operator

## Purpose

Use this guide when manually provisioning a tenant for the shared multi-tenant
pilot.

Workspace and membership provisioning is manual. Provider connections and invoice
settings have UI forms. The complete tenant-readiness gate is planned in the
[roadmap](../product/implementation-roadmap.md#planned-k7-release-gate-tenant-readiness);
this guide describes existing setup, not a completed independent-tenant rollout.

## Required Before You Start

- app/runtime env is working enough for sign-in and the database:
  - `DATABASE_URL`
  - `AUTH_SECRET`
  - Google auth env
  - `APP_URL` or `AUTH_URL`
- `APP_ENCRYPTION_KEY` is set if you will store tenant Mollie or e-Boekhouden
  credentials
- you know the tenant slug and display name
- you know at least one operator email that should be able to use the tenant
- if the tenant should run billing immediately, you have:
  - active invoice provider selected for this tenant
  - the tenant's own Mollie connection, selected profile and payment capabilities,
    regardless of invoice provider; OAuth is the normal connection path
  - complete business/customer invoice profiles and private Blob storage if using
    `Kify`, the default invoice provider
  - Mollie Invoicing activated in the Mollie Dashboard if the active provider is
    `Mollie`
  - tenant e-Boekhouden API token if the active provider is `e-Boekhouden`
  - tenant e-Boekhouden API source if it is not `Kify`
- shared SMTP and cron secrets are configured if you expect invoice delivery,
  alerts, and cron automation to work
- tenant go-live uses live Mollie mode only in the current pilot path

## Required If This Tenant Has Its Own Legal/Contact Defaults

- cancellation contact email
- terms URL
- privacy URL
- terms version

Important:
Current code seeds tenant subscription-policy defaults from env during tenant
provisioning and does not yet expose a normal tenant edit surface for those
values. If this tenant needs values different from your current env defaults,
solve that before onboarding live customers.

## Required Steps

1. Confirm the intended environment and reviewed schema are ready, and the app boots:
   - migration changes are deployment work, not a step to repeat for every tenant
   - the receipt branch's 0031 migration/activation is still pending; follow its
     [separate runbook](eboekhouden-receipt-automation.md)
   - `npm run dev`
2. Provision the tenant:

```bash
npm run tenant:provision -- \
  --slug acme-demo \
  --name "Acme Demo" \
  --operator-email operator@example.com
```

3. Save the returned `tenantId`.
4. Sign in with the operator or platform-operator account.
5. Switch to the new tenant in the dashboard shell.
6. Open `/settings` and complete the tenant connections and invoice settings:
   - connect Mollie, verify the organization/profile and payment capabilities
   - choose Kify (default) or explicitly configure e-Boekhouden as the issuer
   - for Kify, complete the issuer profile, numbering prefix and payment term
   - explicitly select KOR or standard VAT treatment
   - connect e-Boekhouden using its API source/token only if needed for customer
     import or e-Boekhouden issuance; the form stores credentials, while provider
     discovery/readiness confirms whether the connection works
   - invoice template and revenue ledger if the active provider is
     `e-Boekhouden`
7. Confirm the tenant subscription-policy defaults are acceptable for that
   tenant before any live customer onboarding.
8. Verify public app URL and Mollie webhook URL assumptions for the deployment
   you will use. Check effective invoice recipient routing and sender identity;
   the shared Ayal Web sender is not suitable as an implicit independent-tenant
   identity. The 11 November production project read found no invoice-recipient
   override; older override instructions are historical.

The provision command still accepts optional tenant API-key credentials for
compatibility. Never use a key to bypass an incomplete/revoked OAuth connection.
Platform-operator access is a separate administrative choice, not a default grant
for every tenant owner.

## What The Provision Command Actually Does

- creates or updates the tenant row
- creates operator membership if `--operator-email` is supplied
- creates platform-operator access if `--platform-operator-email` is supplied
- ensures tenant subscription-policy default rows exist
- ensures tenant billing/accounting setting rows exist
- optionally stores tenant e-Boekhouden credentials
- optionally stores tenant Mollie credentials for one mode

## Advised Before First Real Customer

- run tenant readiness:
  - `npm run tenant:readiness -- --tenant-id <tenant-id>`
  - this now validates the active invoice provider, not both providers at once
  - if `Mollie` is active, it also checks read-only access to the Sales
    Invoices API and will fail until Mollie Invoicing is activated in the
    Mollie Dashboard
  - the command does not yet cover the complete planned readiness gate; in
    particular, confirm Mollie payment readiness for e-Boekhouden issuers too,
    and separately check recipient/sender, policy values and optional receipts
- open advanced health for the tenant:
  - `/api/health?tenantId=<tenant-id>`
- do one full tenant-context smoke test:
  - create customer
  - complete the customer billing profile; link an e-Boekhouden relation only
    for the applicable accounting/issuer path
  - run hosted consent / first payment, then verify mandate and subscription activation
  - confirm invoice creation
  - confirm invoice delivery
  - confirm webhook processing
  - confirm no cross-tenant leakage in customers, payments, notifications, and
    settings
- review the intended-mode cron results; invoking the billing cron can create
  invoices, send emails and, once enabled, post receipts, so it is not a read-only probe
- verify that the operator account lands inside the correct tenant after sign-in

## Extra

- add a second operator membership before the tenant is used for anything real
- record the tenant slug, tenant id, operator emails, and configured modes in
  your internal rollout notes

## Current Limitations

- tenant creation/membership remains operator-led; Mollie connect/reconnect/profile
  selection and e-Boekhouden credential updates are available in Settings
- billing/accounting settings have a tenant UI on `/settings`; subscription
  policy defaults currently do not
- receipt mapping/cutover is operator CLI configuration on the pending receipt
  branch, not yet a Settings form; it requires the migration, global and tenant
  gates, account/profile verification and the separate accounting-period review
- receipt automation only covers e-Boekhouden-issued invoices; Kify-issued invoice
  synchronization is separate planned integration work, as are fees and payouts
- `npm run ops:invoice-readiness` is platform-only; use
  `npm run tenant:readiness -- --tenant-id <tenant-id>` for tenant go-live
  checks
