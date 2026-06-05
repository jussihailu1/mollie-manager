# Architecture Overview

Status: active reference
Audience: developers

## Purpose

This document describes the current implementation shape of the app. It is not a product-spec or backlog file.

## System Roles

- Mollie: payment collection and mandate source of truth
- e-Boekhouden: invoice and accounting source of truth
- PostgreSQL: local operational state, sync state, alerts, audit logs, invoice queues, and consent evidence
- App server: onboarding, operator UI, reconciliation, webhook processing, protected cron automation, and email delivery

## High-Level Flow

### Subscription onboarding

1. Operator creates or imports a customer.
2. App creates a Mollie first-payment flow.
3. Customer enters the hosted consent flow.
4. Customer accepts the terms snapshot and proceeds to Mollie checkout.
5. Mollie payment and mandate state are synced back into the app.
6. Operator creates the recurring subscription once the first payment and mandate are ready.

### Recurring operations

1. Mollie webhooks or manual repair flows trigger sync.
2. Local state is refreshed from Mollie rather than trusting webhook payloads blindly.
3. Alerts and audit logs are written for important transitions and failures.
4. Invoice automation uses local billing rows plus e-Boekhouden integration to create and deliver invoices safely.

## Main App Surfaces

Primary routes:

- `/`
- `/customers`
- `/payments`
- `/notifications`
- `/settings`
- `/login`
- `/subscribe/[token]`
- `/subscribe/[token]/return`

Legacy redirect routes still exist for compatibility:

- `/alerts` -> `/notifications`
- `/payment-links` -> `/payments`

## Important API Endpoints

- `/api/auth/[...nextauth]`: NextAuth handler
- `/api/health`: minimal public liveness plus auth-gated setup, reliability, and invoice-automation diagnostics
- `/api/webhooks/mollie`: webhook intake and replayable event storage
- `/api/cron/recurring-invoices`: protected repair, invoice, and delivery automation entrypoint
- `/api/eboekhouden/relations`: relation lookup, detail, and linking support

## Code Map

- `auth.ts`: NextAuth configuration
- `lib/env.ts`: environment parsing and readiness checks
- `lib/db.ts`: Drizzle database and pooled PostgreSQL access
- `db/schema.ts`: canonical schema definition
- `lib/mollie/client.ts`: mode-aware Mollie client and webhook URL builder
- `lib/onboarding/*`: onboarding actions and data reads
- `lib/operations/*`: operator actions around subscriptions and workflows
- `lib/eboekhouden/*`: relation linking, invoice creation, reconcile, and retry logic
- `lib/reliability/*`: sync, alerts, repairs, and reporting
- `lib/invoice-delivery*.ts`: invoice email delivery and retry logic

## Data Model Notes

The schema is defined in `db/schema.ts` and migrated through Drizzle.

Important entities:

- `customers`
- `mandates`
- `subscriptions`
- `payments`
- `payment_links`
- `subscription_onboarding_consents`
- `recurring_billing_schedules`
- `tenant_subscription_policy_defaults`
- `tenant_billing_settings`
- `alerts`
- `audit_logs`
- `webhook_events`

## Operational Design Rules

- Persist local state for safety, repair, and auditability.
- Keep Mollie payment truth separate from e-Boekhouden invoice truth.
- Use claim-before-upstream-call patterns for invoice creation to prevent duplicates.
- Treat webhooks as signals that trigger re-fetch and reconciliation.
- Keep test and live mode separation explicit at both env and record level.
