# Mollie Integration

Status: active reference
Audience: developers

## Role

Mollie is the payment and mandate source of truth for this app.

The app stores local operational state, but payment, mandate, and subscription truth must reconcile back to Mollie.

## Mode Model

- Supported modes: `test` and `live`
- Default mode comes from `MOLLIE_DEFAULT_MODE`
- The operator-selected mode is stored in the `mollie_manager_mode` cookie
- In `APP_ENV=test`, the app forces `test` mode and blocks live mode
- Persisted records keep their own `mode` column

## Main Usage Areas

- customer creation
- first-payment flows
- hosted consent -> checkout handoff
- mandate establishment
- recurring subscription creation
- payment, payment-link, and subscription sync
- webhook-driven refresh

## Integration Boundaries

- `lib/mollie/client.ts`: mode-aware client creation and webhook URL building
- `lib/onboarding/*`: onboarding actions and data reads
- `lib/reliability/sync.ts`: sync and reconciliation entrypoints
- `app/api/webhooks/mollie/route.ts`: webhook intake

## Webhooks

- Webhook URL is built from `MOLLIE_WEBHOOK_PUBLIC_BASE_URL`
- Webhook URLs do not include shared secrets
- Webhook events are stored locally before processing
- Processing re-fetches current Mollie state instead of trusting the webhook payload blindly
- Payment and payment-link webhooks must resolve back to managed local app state before processing

## Operational Rules

- A recurring SEPA direct debit in `pending` state is not automatically treated as failed.
- The app distinguishes first payments from recurring payments.
- The hosted consent flow is part of the onboarding contract and precedes Mollie checkout.
- Hosted consent tokens are looked up by hash and recovered for authenticated operator reuse via encrypted storage; run the consent-token backfill after the schema migration to erase legacy plaintext rows.
- Repair and reconciliation flows must not silently change invoice truth in e-Boekhouden.

## Relevant Env

- `MOLLIE_DEFAULT_MODE`
- `MOLLIE_TEST_API_KEY`
- `MOLLIE_LIVE_API_KEY`
- `MOLLIE_ORGANIZATION_ID`
- `MOLLIE_PROFILE_ID`
- `MOLLIE_WEBHOOK_PUBLIC_BASE_URL`
