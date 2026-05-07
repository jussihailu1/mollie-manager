# Mollie Manager AI Handoff

## Purpose

This file is meant to replace the lost chat context. It summarizes:

- what Mollie Manager is supposed to be
- the decisions that were already made with the user
- what has already been implemented in this repo
- what the current codebase looks like
- what the user asked for next

## Product Goal

Mollie Manager is an internal backoffice for one operator to manage subscription setup and recurring subscription operations on top of Mollie.

The core workflow is:

1. Create a customer.
2. Create a customer-linked first payment in Mollie with `sequenceType=first`.
3. Restrict that first payment to `iDEAL` so it can establish the later direct debit mandate.
4. Current implementation shares an app-hosted consent URL with the customer. The customer accepts terms in-app before being redirected to Mollie checkout for the mandate-establishing first payment.
5. After the first payment succeeds, sync the customer and mandate state from Mollie.
6. Create the recurring subscription using the verified mandate.
7. Monitor recurring payments, failures, disputes, stopped subscriptions, and sync drift.

This is not meant to be a generic payment dashboard. The product is centered on safe subscription creation and management.

## Locked Product Decisions

These decisions were explicitly made in the old chat and should be treated as the current product baseline unless the user changes them.

- The app is for internal use only.
- The only staff user is the owner.
- Login should be Google sign-in with a single allowlisted email address.
- Use Mollie API keys on the server, not Mollie OAuth/app access tokens.
- NL first and EUR first.
- The first payment mode defaults to charging the real first installment, with optional `mandate_only` (`€0.01`) when mandate setup should be decoupled from the first recurring installment.
- The recurring onboarding entrypoint is an app-hosted consent URL, not a raw Mollie checkout URL.
- Consent acceptance is required and is bound to an exact plan snapshot before recurring subscription creation.
- Current implementation derives the billing date from the first successful payment. Upcoming term-model work must not assume monthly-only billing forever.
- Default cancellation behavior is "stop future charges after the current paid period."
- Alerts go to the owner only.
- Payment links are still needed as a separate module for one-off use cases, but they are not the main recurring onboarding primitive.
- PostgreSQL is part of the intended architecture.
- Mollie remains the financial source of truth.
- The local database is the operational and safety layer.

## Subscription Policy Direction

Canonical docs:

- Current-state policy: `documentation/subscription-policy.md`
- Future-state roadmap: `documentation/subscription-roadmap.md`

Locked direction for the next subscription feature pass:

- Use `subscription_term_mode: open_ended | fixed_term`.
- For fixed-term subscriptions, use `total_payments` as billing source of truth.
- Treat `last_charge_date` as derived or validated display/audit data.
- Treat `service_end_at` as distinct from the final billing date.
- Use `cancellation_effect: immediate | end_of_paid_period` for entitlement behavior.
- Do not add overlapping top-level fields that restate the same policy meaning.
- V1 consent must happen before Mollie checkout.
- V1 consent must disclose billing terms, service-end behavior, cancellation method, and cancellation email.
- V1 cancellation channel for the customer is email, not self-serve UI.
- Tenant default policy is the direction. Per-subscription overrides are explicitly later work.

## Why The Database Exists

The database is not meant to replace Mollie as the payment truth. It exists to support the app-specific behavior Mollie does not provide by itself.

Local storage is used for:

- Google-authenticated app access context
- local customer IDs linked to Mollie IDs
- local subscription and payment records linked to Mollie IDs
- mandates synced from Mollie
- webhook inbox storage
- audit logs
- alert records and email-delivery state
- reconciliation support
- derived operational statuses like `mandate_pending`, `payment_action_required`, and `out_of_sync`

## What Was Built

### Phase 1: Foundation

Implemented:

- dashboard shell and app framing
- placeholder module routes
- shared UI/domain scaffolding
- health route
- `.env.example`

Relevant files:

- `app/(dashboard)/layout.tsx`
- `app/(dashboard)/page.tsx`
- `app/api/health/route.ts`
- `app/globals.css`
- `lib/app-config.ts`
- `.env.example`

### Phase 2: Platform Setup

Implemented:

- Google auth scaffold with one-email allowlist
- validated env loading with readiness reporting
- PostgreSQL pool and transaction helpers
- SQL migration runner
- initial database schema
- server-only Mollie client boundary

Relevant files:

- `auth.ts`
- `app/api/auth/[...nextauth]/route.ts`
- `app/login/page.tsx`
- `lib/auth/*`
- `lib/env.ts`
- `lib/db.ts`
- `db/migrations/0001_initial.sql`
- `scripts/db-apply.mjs`
- `lib/mollie/client.ts`

### Phase 3: Subscription Onboarding

Implemented:

- customer creation
- first payment link creation
- app-hosted consent URL generation and consent evidence capture
- customer sync from Mollie
- mandate syncing
- subscription creation
- duplicate first-payment protection
- duplicate active/in-progress subscription protection

Relevant files:

- `app/(dashboard)/customers/page.tsx`
- `app/(dashboard)/customers/[customerId]/page.tsx`
- `components/customers-workspace.tsx`
- `lib/onboarding/actions.ts`
- `lib/onboarding/data.ts`

### Phase 4: Operations Workspace

Implemented:

- subscription details integrated into the customers workspace
- payments workspace
- derived alert queue
- guarded "stop future charges" action
- manual sync actions
- subscription stop-flag migration fix

Relevant files:

- `components/customers-workspace.tsx`
- `app/(dashboard)/payments/page.tsx`
- `app/(dashboard)/alerts/page.tsx`
- `lib/operations/actions.ts`
- `db/migrations/0002_subscription_stop_default.sql`

### Phase 5: Reliability Layer

Implemented:

- Mollie webhook ingestion
- replayable webhook event storage
- sync/reconciliation layer
- durable alerts
- SMTP email delivery
- manual reconciliation action
- manual webhook replay action

Relevant files:

- `app/api/webhooks/mollie/route.ts`
- `lib/reliability/sync.ts`
- `lib/reliability/actions.ts`
- `lib/reliability/alerts.ts`
- `lib/reliability/data.ts`
- `lib/notifications/email.ts`

### Post-Phase Fixes And Follow-Up Work

Also completed later in the old chat:

- build fix for stale `.next/dev` type artifacts via `prebuild`
- `NEXT_REDIRECT` / server action error-handling fix by using `unstable_rethrow(error)` before generic catch handling
- manual "send test alert" path
- first big dashboard UI redesign toward a cleaner operator-first interface

Relevant files:

- `package.json`
- `scripts/clean-next-dev-types.mjs`
- `lib/onboarding/actions.ts`
- `lib/operations/actions.ts`
- `lib/reliability/actions.ts`
- `app/(dashboard)/*`
- `components/*`
- `app/globals.css`

## Current Codebase Snapshot

Verified from the repo on 2026-04-07.

### Stack

- Next.js `16.2.2`
- React `19.2.4`
- NextAuth `5.0.0-beta.30`
- PostgreSQL via raw `pg`
- Mollie via `@mollie/api-client`
- SMTP mail via `nodemailer`
- validation via `zod`

### Important Architectural Traits

- No ORM is used.
- Database schema lives in raw SQL under `db/migrations`.
- Server-side data access uses `lib/db.ts`.
- Auth is centralized in `auth.ts` and `lib/auth/session.ts`.
- Mollie access is centralized in `lib/mollie/client.ts`.
- Most mutations are implemented as Next server actions.
- Audit logs are written through `lib/audit.ts`.
- Webhooks are stored before processing.
- Sync logic re-fetches current Mollie state instead of trusting webhook payloads blindly.

### Database Tables

From `db/migrations/0001_initial.sql`, the app currently has:

- `customers`
- `mandates`
- `subscriptions`
- `payments`
- `payment_links`
- `alerts`
- `audit_logs`
- `webhook_events`

Enums already exist for:

- mollie mode
- local subscription lifecycle state
- payment lifecycle type
- alert severity/status
- audit outcome
- actor kind
- webhook processing status

### Route Map

Main UI:

- `/`
- `/customers`
- `/customers/[customerId]`
- `/payments`
- `/payment-links`
- `/alerts`
- `/settings`
- `/login`

API:

- `/api/auth/[...nextauth]`
- `/api/health`
- `/api/webhooks/mollie`

### Core File Map

If a future AI needs to orient quickly, these are the highest-value files first:

- `auth.ts`: NextAuth config and Google allowlist behavior
- `lib/env.ts`: env parsing, readiness checks, mode config, SMTP config
- `lib/db.ts`: Postgres pool, query, transaction
- `lib/mollie/client.ts`: Mollie client creation and webhook URL builder
- `lib/onboarding/actions.ts`: create customer, create first payment, sync customer, create subscription
- `lib/onboarding/data.ts`: read models for customers, payments, subscriptions
- `lib/operations/actions.ts`: sync/cancel subscription actions
- `lib/reliability/sync.ts`: sync and reconciliation logic
- `lib/reliability/actions.ts`: replay/reconcile/test-alert actions
- `lib/reliability/alerts.ts`: durable alert open/resolve/email behavior
- `app/api/webhooks/mollie/route.ts`: webhook entrypoint
- `app/(dashboard)/*`: UI surfaces

## Important Implementation Notes For Future AI Work

### 1. This repo uses breaking-change Next.js

`AGENTS.md` explicitly warns that this is not the older Next.js API surface. Before touching framework-level code, read the relevant guide in `node_modules/next/dist/docs/`.

### 2. The current README is stale

`README.md` is still the default create-next-app README. Do not rely on it for project behavior.

### 3. Test/live mode is not a runtime toggle today

Current behavior:

- `MOLLIE_DEFAULT_MODE` comes from env
- new write flows use the default client unless a specific record mode is already known
- stored customers, subscriptions, payments, mandates, and webhook events all persist their own `mode`

This means a future UI toggle is not just a visual toggle. It needs a real design for how the operator selects the mode for new work.

### 4. The first payment flow now runs through hosted consent before Mollie checkout

The recurring onboarding flow now creates a first-payment Mollie link for `sequenceType=first`, but the customer-facing entrypoint is the app-hosted consent page (`/subscribe/[token]`), not the raw Mollie URL.

Consent evidence is stored with a plan snapshot and required-checkbox acknowledgements. Subscription creation is bound to that accepted snapshot.

### 5. Webhooks are signals, not trusted truth

The codebase follows the rule that webhook arrivals should trigger a re-fetch from Mollie. This pattern already exists in `lib/reliability/sync.ts` and should be preserved.

### 6. Server action redirect handling has already bitten this app once

There was a fix for `NEXT_REDIRECT` / "Action blocked" behavior. When touching server actions that may redirect, keep the existing `unstable_rethrow(error)` pattern in place before generic error handling.

### 7. Alerts are durable even if SMTP fails

The intended behavior is:

- create/store the alert first
- attempt email delivery second
- keep the alert visible even if email fails

That pattern is important and should stay intact.

### 8. `.env.example` is functionally correct, but the notification example is outdated

The env variable names remain:

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASSWORD`
- `SMTP_FROM`
- `ALERT_EMAIL_TO`

The user later decided to use Brevo SMTP values instead of Gmail values. Future AI should keep the same env keys and swap the values, not rename the variables.

### 9. This worktree is not clean

At the time of documentation, `git status --short` showed uncommitted changes across:

- `app/(dashboard)/*`
- `app/globals.css`
- `components/*`
- `lib/app-config.ts`
- `lib/reliability/*`

Treat the current working tree as the actual baseline the user sees, not just the last commit.

## Current UI State

There has already been one full UI redesign pass. The app currently uses custom components like:

- `PageHeader`
- `KpiStrip`
- `FilterBar`
- `DataTable`
- `DetailSection`
- `DrawerForm`
- `InlineNotice`
- `EmptyState`
- `StatusPill`

The current UI is noticeably more structured than the original starter, but it still has characteristics the user now wants changed:

- lots of custom components instead of shadcn primitives
- a `max-w-[1600px]` shell cap in `app/(dashboard)/layout.tsx`
- multiple uppercase / wide-tracked labels
- developer-facing readiness/status badges in the shell
- the send-test-alert action still lives on `/settings`
- the bottom sidebar content still exists as sidebar content instead of a logo-triggered modal/popover
- settings still includes "Operator context" and "Operational notes"

Also note that `package.json` currently does not include shadcn/Radix-style component dependencies, so the requested shadcn shift has not started yet.

## What We Are Doing Now

The active product direction is the next subscription-policy and consent-flow pass.

Immediate documentation-backed implementation targets:

- fixed-term subscription support
- explicit consent screen before the mandate-establishing first payment (implemented)
- cancellation-by-email disclosure in the onboarding terms
- tenant-default subscription policy model

Use `documentation/subscription-policy.md` as the current implementation spec and `documentation/subscription-roadmap.md` for later subscription-platform work.

## Mode-Toggle Design Note

This deserves its own note because it is the biggest hidden implementation trap in the current next task.

What exists today:

- new customer and first-payment creation flows use the default Mollie client
- the default mode is loaded from env
- persisted records keep their own mode

That means a runtime mode switch must answer at least these questions:

- Is the toggle only for new writes, or also for list-page filtering?
- Where is the operator's selected mode stored: cookie, DB setting, session, or env-backed fallback?
- Should list pages show both modes together, or default to the selected mode?
- Should mode-switching ever affect existing record operations, or only new creations?

Future AI should resolve those questions before implementing the UI toggle.

## Fast Start For Future AI Sessions

If a future session needs to resume work quickly:

1. Read this file first.
2. Ignore `README.md` unless it has been rewritten.
3. Review `AGENTS.md`.
4. Check `package.json` and `db/migrations/*`.
5. Review `lib/env.ts`, `lib/mollie/client.ts`, `lib/onboarding/actions.ts`, and `lib/reliability/sync.ts`.
6. Review `app/(dashboard)/layout.tsx`, `app/(dashboard)/settings/page.tsx`, and `app/(dashboard)/alerts/page.tsx` for the current UI baseline.
7. Run:
   - `npm run db:apply`
   - `npm run lint`
   - `npx tsc --noEmit`
   - `npm run build`

## Short Summary

Goal:

- safe single-operator Mollie subscription management with a strong onboarding flow and a real reliability layer

Done:

- foundation, auth, env validation, database, onboarding flow, subscription operations, webhooks, alerts, reconciliation, and a first major UI redesign

Now:

- the next active task is the subscription-policy, consent-flow, and future-safe term-model pass documented in `documentation/subscription-policy.md`
