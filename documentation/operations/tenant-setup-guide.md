# Tenant Setup Guide

Status: active reference
Audience: platform operator

## Purpose

Use this guide when manually provisioning a tenant for the shared multi-tenant
pilot.

This is the current practical path in code today. It is intentionally manual.

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
  - tenant Mollie API key for live mode if the active provider is `Mollie`
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

1. Apply migrations and confirm the app boots:
   - `npm run db:apply`
   - `npm run dev`
2. Provision the tenant:

```bash
npm run tenant:provision -- \
  --slug acme-demo \
  --name "Acme Demo" \
  --operator-email operator@example.com \
  --platform-operator-email admin@example.com \
  --mollie-api-key live_xxx \
  --mollie-mode live \
  --eboekhouden-api-token xxx \
  --eboekhouden-api-source Kify
```

3. Save the returned `tenantId`.
4. Sign in with the operator or platform-operator account.
5. Switch to the new tenant in the dashboard shell.
6. Open `/settings` and complete the tenant billing/accounting settings:
   - active invoice provider
   - invoice template and revenue ledger if the active provider is
     `e-Boekhouden`
   - VAT code and related accounting settings
7. Confirm the tenant subscription-policy defaults are acceptable for that
   tenant before any live customer onboarding.
8. Verify public app URL and Mollie webhook URL assumptions for the deployment
   you will use.

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
- open advanced health for the tenant:
  - `/api/health?tenantId=<tenant-id>`
- do one full tenant-context smoke test:
  - create customer
  - link e-Boekhouden relation
  - run hosted consent / first payment
  - confirm invoice creation
  - confirm invoice delivery
  - confirm webhook processing
  - confirm no cross-tenant leakage in customers, payments, notifications, and
    settings
- trigger cron once in the intended mode and review the tenant-local results
- verify that the operator account lands inside the correct tenant after sign-in

## Extra

- add a second operator membership before the tenant is used for anything real
- record the tenant slug, tenant id, operator emails, and configured modes in
  your internal rollout notes

## Current Limitations

- tenant provider credentials are currently managed through
  `npm run tenant:provision`, not through a normal UI
- billing/accounting settings have a tenant UI on `/settings`; subscription
  policy defaults currently do not
- `npm run ops:invoice-readiness` is platform-only; use
  `npm run tenant:readiness -- --tenant-id <tenant-id>` for tenant go-live
  checks
