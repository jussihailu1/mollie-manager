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
  - `APP_ENCRYPTION_KEY`
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

Platform/bootstrap env still present in code today:

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
multi-tenant pilot now uses tenant-owned stored Mollie and e-Boekhouden
credentials for active tenant business flows, while platform env remains for
platform/runtime concerns such as auth, database, app URL, cron secrets, shared
SMTP, bootstrap defaults, and older readiness tooling that still assumes some
env-backed checks.
Current tenant business flows fail closed without explicit tenant context and do
not fall back to app-wide Mollie or e-Boekhouden credentials.
`APP_ENCRYPTION_KEY` is also a platform/runtime secret and now encrypts stored
tenant Mollie and e-Boekhouden credentials. Keep it stable per environment, and
rotate it with a credential re-encryption/backfill plan rather than ad hoc.

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
- Older local env files may still contain `AUTH_ALLOWED_EMAIL`, but product
  access now comes from tenant membership or platform-operator records. Do not
  reintroduce product behavior that depends on a global email gate.
- `AUTH_ADVANCED_EMAILS` is a comma-separated allowlist for technical settings
  controls such as diagnostics, repair, replay, reconciliation, SMTP tests, and
  invoice batch/retry controls. It does not create product access by itself and
  must not bypass tenant membership or tenant context.
- `AUTH_SECRET` is required at runtime; the app now fails closed if it is missing.
- `APP_ENCRYPTION_KEY` is required before writing or reading new-format tenant
  provider credentials.
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

Current implementation note:

- tenant, platform-operator, and operator-membership tables now exist
- tenant-owned subscription-policy defaults and billing/accounting defaults now
  persist per tenant instead of one shared `"default"` row
- a legacy `legacy-default` tenant row is created by migration only to keep the
  current single-context deployment bootable during the foundation work
- provision real tenants with `npm run tenant:provision -- --slug <slug> --name <name> --operator-email <email>`
- tenant-scoped auth/session resolution and tenant-scoped core business tables
  are already in place; remaining pilot work is mostly tenant-specific go-live
  verification and a few operational/tooling follow-up seams

## Database Notes

- The app uses Drizzle ORM with PostgreSQL.
- The schema lives in `db/schema.ts`.
- Generated migrations live in `db/drizzle`.
- `scripts/db-apply.mjs` loads env and applies Drizzle migrations.

## Next.js Note

This repo uses `next@16` and `next-auth@5 beta`. Do not proactively read `node_modules/next/dist/docs/`. Only consult the specific relevant file there if you are changing framework-level behavior and the current API semantics are uncertain.
