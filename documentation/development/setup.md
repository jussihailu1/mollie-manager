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

Create a local `.env` using the groups below and an isolated development database.
`.env.example` is not tracked in the current checkout; an existing local sample
may be used only after checking that its values are appropriate for development.

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
  - `CRON_SECRET` (or the supported legacy `INVOICE_CRON_SHARED_SECRET`)
- Mollie Connect platform application:
  - `MOLLIE_CONNECT_CLIENT_ID`
  - `MOLLIE_CONNECT_CLIENT_SECRET`
  - `MOLLIE_CONNECT_REDIRECT_URI`
- Kify private invoice artifacts:
  - `BLOB_READ_WRITE_TOKEN` for the intended private Blob store
- Future receipt automation (receipt branch; defaults off):
  - `EBOEKHOUDEN_RECEIPT_AUTOMATION_ENABLED`
  - enable only with reviewed migration 0031 and tenant configuration from the
    [receipt runbook](../operations/eboekhouden-receipt-automation.md)

Platform/bootstrap env still present in code today:

- `MOLLIE_DEFAULT_MODE`
- `MOLLIE_TEST_API_KEY`
- `MOLLIE_LIVE_API_KEY`
- `MOLLIE_WEBHOOK_PUBLIC_BASE_URL`
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
2. Create the local `.env` described above.
3. Review the target database and branch migration state, then apply migrations:
   `npm run db:apply`
4. Optionally verify the database:
   `npm run db:smoke`
5. Start the app:
   `npm run dev`

## Authentication Notes

- Google sign-in is the current supported provider in code.
- Use the **Mollie Manager local** Google OAuth client for local development.
  Keep its `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` in `.env`. Do not copy the
  production client values into `.env.local`: Next.js loads `.env.local` after
  `.env`, so its values override the local client and can cause Google
  `redirect_uri_mismatch` errors or send OAuth callbacks to the wrong app URL.
- For ngrok testing, update only the local public URL settings (`AUTH_URL` and
  `APP_URL`) to the current tunnel URL and register
  `https://<ngrok-host>/api/auth/callback/google` on the **Mollie Manager local**
  Google OAuth client. Restart the dev server after changing environment values.
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

For the shared multi-tenant pilot, the following are tenant-owned stored
configuration. Policy values are still seeded from env during provisioning and
must be reviewed for each tenant:

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
3. connect the tenant's Mollie organization/profile through Settings
4. optionally connect e-Boekhouden through its Settings credential form
5. configure Kify invoice profiles/tax choice, or explicit e-Boekhouden issuer settings
6. configure tenant subscription policy defaults
7. verify webhook/public URL assumptions
8. run `npm run tenant:readiness -- --tenant-id <tenant-id>` and complete the
   additional checks in the [tenant setup guide](../operations/tenant-setup-guide.md)
   before any controlled live pilot; the command alone is not the complete gate

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
- The receipt branch validates the upgrade from deployed snapshot 0029 to 0031.
  It deliberately excludes the preserved, deferred OAuth migration 0030. That
  work needs a later number and fresh journal timestamp when resumed. Full
  historical migration replay on an empty database has a known duplicate-index
  issue and was not proved by the receipt upgrade tests; see the receipt runbook.

## Next.js Note

This repo uses `next@16` and `next-auth@5 beta`. Do not proactively read `node_modules/next/dist/docs/`. Only consult the specific relevant file there if you are changing framework-level behavior and the current API semantics are uncertain.
