# Development Setup

Status: active reference
Audience: developers

## Prerequisites

- Node.js compatible with the project dependencies
- PostgreSQL
- A supported auth provider configuration
- Google OAuth app credentials for the current implementation
- Platform SMTP credentials if you need alert or invoice delivery

For the shared multi-tenant pilot, Mollie and e-Boekhouden business credentials
must be tenant-owned rather than one global env-backed pair.

## Environment

Copy `.env.example` to `.env` and fill in the values you need.

Main env groups:

- Application:
  - `APP_ENV`
  - `APP_URL`
  - `AUTH_URL`
- Authentication:
  - `AUTH_SECRET`
  - `AUTH_ADVANCED_EMAILS`
  - `AUTH_GOOGLE_ID`
  - `AUTH_GOOGLE_SECRET`
- Database:
  - `DATABASE_URL`
  - `DATABASE_SSL`
- Notifications and invoice delivery:
  - `SMTP_HOST`
  - `SMTP_PORT`
  - `SMTP_USER`
  - `SMTP_PASSWORD`
  - `SMTP_FROM`
  - `ALERT_EMAIL_TO`
  - `INVOICE_EMAIL_OVERRIDE_TO`
- Invoice automation:
  - `INVOICE_CRON_SHARED_SECRET`

Current implementation debt still present in code today:

- `AUTH_ALLOWED_EMAIL`
- `MOLLIE_DEFAULT_MODE`
- `MOLLIE_TEST_API_KEY`
- `MOLLIE_LIVE_API_KEY`
- `MOLLIE_WEBHOOK_PUBLIC_BASE_URL`
- `EBOEKHOUDEN_API_TOKEN`
- `EBOEKHOUDEN_API_SOURCE`
- `SUBSCRIPTION_CANCELLATION_EMAIL`
- `SUBSCRIPTION_TERMS_URL`
- `SUBSCRIPTION_PRIVACY_URL`
- `SUBSCRIPTION_TERMS_VERSION`

Do not extend product scope around those app-wide business credentials. The
multi-tenant pilot foundation must replace them with tenant-owned stored
configuration, while platform env should remain for platform/runtime concerns
such as auth, database, app URL, cron secrets, and shared SMTP.

## Local Bootstrap

1. Install dependencies:
   `npm install`
2. Create `.env` from `.env.example`.
3. Apply migrations:
   `npm run db:apply`
4. Optionally verify the database:
   `npm run db:smoke`
5. Start the app:
   `npm run dev`

## Authentication Notes

- Google sign-in is the current supported provider in code.
- Future providers may be added later; product authorization must not depend on
  Google specifically.
- Target product authorization for the shared multi-tenant pilot is membership
  based: a signed-in operator must have tenant membership or a controlled
  platform-operator bootstrap path.
- `AUTH_ALLOWED_EMAIL` is current implementation debt, not the desired product
  access model. Replace it during the multi-tenant pilot foundation and do not
  build new product behavior on top of it.
- `AUTH_ADVANCED_EMAILS` is a comma-separated allowlist for technical settings
  controls such as diagnostics, repair, replay, reconciliation, SMTP tests, and
  invoice batch/retry controls. It does not create product access by itself and
  must not bypass tenant membership or tenant context.
- `AUTH_SECRET` is required at runtime; the app now fails closed if it is missing.
- `APP_ENV=test` can use the test bypass flags for local verification without normal Google login.
- In `APP_ENV=test`, live Mollie mode is disabled by design.

## Tenant-Owned Business Configuration

For the shared multi-tenant pilot, the following must become tenant-owned stored
configuration rather than app-wide env defaults:

- Mollie credentials/configuration
- e-Boekhouden credentials/configuration
- subscription cancellation email
- terms URL
- privacy URL
- terms version
- default cancellation effect
- billing/accounting settings

Platform-wide SMTP may remain shared for the pilot. Tenant-specific SMTP
overrides are later scope.

## Manual Tenant Provisioning

Manual tenant onboarding is the canonical pilot path.

Expected flow:

1. create tenant
2. create one or more operator memberships
3. store tenant Mollie credentials/configuration
4. store tenant e-Boekhouden credentials/configuration
5. configure tenant billing/accounting settings
6. configure tenant subscription policy defaults
7. verify webhook/public URL assumptions
8. run readiness checks in that tenant context before live customer usage

No self-serve tenant signup or invite flow is required for the pilot.

## Database Notes

- The app uses Drizzle ORM with PostgreSQL.
- The schema lives in `db/schema.ts`.
- Generated migrations live in `db/drizzle`.
- `scripts/db-apply.mjs` loads env and applies Drizzle migrations.

## Next.js Note

This repo uses `next@16` and `next-auth@5 beta`. Do not proactively read `node_modules/next/dist/docs/`. Only consult the specific relevant file there if you are changing framework-level behavior and the current API semantics are uncertain.
