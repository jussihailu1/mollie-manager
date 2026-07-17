# Mollie Integration

Status: active reference
Audience: developers

## Role

Mollie is the payment and mandate source of truth for this app.

The app stores local operational state, but payment, mandate, and subscription truth must reconcile back to Mollie.

For the shared multi-tenant pilot, each tenant owns its own Mollie
credentials/configuration. Tenant business flows must not rely on one shared
app-wide Mollie account.

Current tenant business calls still use manually provisioned API keys. Mollie
Connect now has tenant-owned OAuth state, callback, encrypted token refresh,
scope validation, revoke/disconnect, and reconnect foundations. Business-flow
migration to the credential-neutral resolver remains active roadmap work.

The accepted production OAuth ownership, scope, lifecycle, migration, and
failure contract is in [Mollie Connect Connection Contract](mollie-connect-contract.md).
It is implementation policy; it does not claim the OAuth runtime exists yet.

## Mode Model

- Supported modes: `test` and `live`
- `MOLLIE_DEFAULT_MODE` still selects the default runtime mode when a request or
  operator has not chosen one explicitly
- The operator-selected mode is stored in the `mollie_manager_mode` cookie
- In `APP_ENV=test`, the app forces `test` mode and blocks live mode
- Persisted records keep their own `mode` column

Mode and tenant are separate concerns. A tenant business record must resolve
both its tenant and its Mollie mode.

## Main Usage Areas

- customer creation
- first-payment flows
- hosted consent -> checkout handoff
- mandate establishment
- recurring subscription creation
- payment, payment-link, and subscription sync
- webhook-driven refresh

All of these flows must resolve the tenant's Mollie credentials before calling
Mollie.

## Integration Boundaries

- `lib/mollie/client.ts`: mode-aware client creation and webhook URL building
- `lib/onboarding/*`: onboarding actions and data reads
- `lib/reliability/sync.ts`: sync and reconciliation entrypoints
- `app/api/webhooks/mollie/route.ts`: webhook intake

## Webhooks

- Webhook URL is still built from `MOLLIE_WEBHOOK_PUBLIC_BASE_URL`
- webhook follow-up must resolve tenant context from local state before tenant
  business processing continues
- Webhook URLs do not include shared secrets
- Webhook events are stored locally before processing
- Processing re-fetches current Mollie state instead of trusting the webhook payload blindly
- Payment and payment-link webhooks must resolve back to managed local app state before processing
- If a webhook cannot be mapped to one tenant-owned local resource and tenant
  context, processing must fail safely and never fall back to one shared global
  Mollie account

## Operational Rules

- A recurring SEPA direct debit in `pending` state is not automatically treated as failed.
- The app distinguishes first payments from recurring payments.
- The hosted consent flow is part of the onboarding contract and precedes Mollie checkout.
- Hosted consent and hosted return flows may keep normal product URLs; tenant
  context is resolved from the onboarding token and linked local state.
- Hosted consent tokens are looked up by hash and recovered for authenticated operator reuse via encrypted storage; run the consent-token backfill after the schema migration to erase legacy plaintext rows.
- Failed Mollie webhook events can be replayed from the operator ops surface, but replay is now limited to failed stored events in the selected mode.
- Repair and reconciliation flows must not silently change provider-owned invoice truth.
- Tenant-owned Mollie credentials must be used consistently in onboarding,
  subscription creation, sync, replay, repair, and webhook follow-up flows.
- app-wide Mollie env may still exist for runtime/bootstrap concerns, but active
  tenant business flows must not fall back to one shared Mollie account.

## Relevant Env

- `MOLLIE_DEFAULT_MODE`
- `MOLLIE_TEST_API_KEY`
- `MOLLIE_LIVE_API_KEY`
- `MOLLIE_ORGANIZATION_ID`
- `MOLLIE_PROFILE_ID`
- `MOLLIE_WEBHOOK_PUBLIC_BASE_URL`

These env values now describe mode/runtime/bootstrap concerns more than the
active tenant business credential model.
