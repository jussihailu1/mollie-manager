# Development Setup

Status: active reference
Audience: developers

## Prerequisites

- Node.js compatible with the project dependencies
- PostgreSQL
- A Google OAuth app for NextAuth sign-in
- Mollie API credentials
- e-Boekhouden API token if you need relation linking or invoice flows
- SMTP credentials if you need alert or invoice delivery

## Environment

Copy `.env.example` to `.env` and fill in the values you need.

Main env groups:

- Application:
  - `APP_ENV`
  - `APP_URL`
  - `AUTH_URL`
- Authentication:
  - `AUTH_SECRET`
  - `AUTH_ALLOWED_EMAIL`
  - `AUTH_ADVANCED_EMAILS`
  - `AUTH_GOOGLE_ID`
  - `AUTH_GOOGLE_SECRET`
- Database:
  - `DATABASE_URL`
  - `DATABASE_SSL`
- Mollie:
  - `MOLLIE_DEFAULT_MODE`
  - `MOLLIE_TEST_API_KEY`
  - `MOLLIE_LIVE_API_KEY`
  - `MOLLIE_WEBHOOK_PUBLIC_BASE_URL`
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
- e-Boekhouden:
  - `EBOEKHOUDEN_API_TOKEN`
  - `EBOEKHOUDEN_API_SOURCE`
- Subscription-policy defaults:
  - `SUBSCRIPTION_CANCELLATION_EMAIL`
  - `SUBSCRIPTION_TERMS_URL`
  - `SUBSCRIPTION_PRIVACY_URL`
  - `SUBSCRIPTION_TERMS_VERSION`

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

- Normal app access uses Google sign-in and a single allowed email address.
- `AUTH_ALLOWED_EMAIL` is enforced in the NextAuth sign-in callback.
- `AUTH_ADVANCED_EMAILS` is a comma-separated allowlist for technical settings controls such as diagnostics, repair, replay, reconciliation, SMTP tests, and invoice controls.
- `AUTH_SECRET` is required at runtime; the app now fails closed if it is missing.
- `APP_ENV=test` can use the test bypass flags for local verification without normal Google login.
- In `APP_ENV=test`, live Mollie mode is disabled by design.

## Database Notes

- The app uses Drizzle ORM with PostgreSQL.
- The schema lives in `db/schema.ts`.
- Generated migrations live in `db/drizzle`.
- `scripts/db-apply.mjs` loads env and applies Drizzle migrations.

## Next.js Note

This repo uses `next@16` and `next-auth@5 beta`. Do not proactively read `node_modules/next/dist/docs/`. Only consult the specific relevant file there if you are changing framework-level behavior and the current API semantics are uncertain.
