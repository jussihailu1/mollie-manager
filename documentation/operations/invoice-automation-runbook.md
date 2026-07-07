# Invoice Automation Runbook

Status: active operations runbook
Audience: operators and developers

## Purpose

Production ops checklist for automated invoice creation + app-owned customer invoice email delivery.

## Required Env

- `INVOICE_CRON_SHARED_SECRET`
  - Required for protected cron route auth.
  - Use strong random token.
  - If deployed on Vercel Cron, `CRON_SECRET` is also accepted.
- `INVOICE_EMAIL_OVERRIDE_TO` (optional)
  - If set, all customer invoice emails route to this address.
  - Intended customer recipient remains in invoice delivery metadata/audit.

Existing SMTP env remains required for app delivery:

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASSWORD`
- `SMTP_FROM`

## Protected Cron Endpoint

- Method: `POST`
- URL: `/api/cron/recurring-invoices`
- Auth header:
  - `Authorization: Bearer <INVOICE_CRON_SHARED_SECRET>`
- Query params:
  - `mode=test|live` (optional, defaults to `MOLLIE_DEFAULT_MODE`)
  - `limit=1..200` (optional, defaults to `25`)

## What Cron Does

1. Auto-queues safe failed retries (`FACT_014`, `FACT_VERWERK_004`) back to pending for both recurring and first-payment invoice rows.
2. Reconciles failed rows with existing e-Boekhouden invoices and recovers local state when upstream already has invoice.
3. Creates due recurring invoices (`invoice_send_due_date <= current_date`) with duplicate-safe claim state.
4. Creates due first-payment invoices as fallback automation (in addition to paid sync trigger).
5. Retries unsent recurring invoice emails where invoice already exists upstream.
6. Retries unsent first-payment invoice emails where invoice already exists upstream.
7. Sends invoice document in app email:
   - PDF attachment when a trusted `https://*.e-boekhouden.nl` document URL can be downloaded within the attachment limits.
   - fallback safe link when attachment download is unavailable, oversized, times out, or the upstream URL is not trusted.

Invoice creation truth remains upstream:

- If email send fails, upstream invoice remains created.
- Local send success tracked via `invoice_sent_at` and `invoice_state = invoice_sent`.
- Email retries use backoff windows with max attempts; after max attempts, delivery is marked permanent failure and a critical operator alert is opened.

## Liveness Signals

`/api/health` is now split:

- public requests get a minimal liveness payload only
- detailed diagnostics require either an advanced operator session or `Authorization: Bearer <INVOICE_CRON_SHARED_SECRET>` / `Authorization: Bearer <CRON_SECRET>`

Authenticated `/api/health` includes platform diagnostics. Authenticated
`/api/health?tenantId=<tenant-id>` adds tenant-scoped live readiness and
reliability diagnostics, including:

- `invoiceAutomationCron.lastCronRunAt`
- `invoiceAutomationCron.lastCronRunOutcome`
- `invoiceAutomationCron.lastCronSuccessAt`
- `invoiceAutomationCron.lastCronFailureAt`

Use these advanced/cron diagnostics to confirm scheduler liveness without checking platform logs first. The `/settings` developer controls surface the same signals for advanced operators, while raw JSON stays available for direct inspection.

The `/settings` developer controls and advanced/cron `/api/health` diagnostics now share the same reliability ops snapshot, so webhook health, invoice automation, delivery retries, and cron heartbeat stay aligned across both views.

The settings page also exposes a targeted repair form for single customer, payment, or subscription resyncs. Use that when one record needs a focused repair without running broader cron recovery.

Operator reconciliation from `/settings` now has explicit modes:

- `sync_only`: refresh Mollie-backed local state only
- `full`: refresh state and allow first-payment invoice create / activation follow-ups

Use `sync_only` first when investigating stale state or webhook drift.

After each reconciliation, `/settings` now also shows the latest first-payment and recurring invoice-state delta summary with before/after counts. Use that summary to confirm whether the run only refreshed state or also changed invoice-tracking rows.

## Current Scheduler State In Repo

`vercel.json` currently configures:

- path: `/api/cron/recurring-invoices`
- schedule: `0 3 * * *`

That means the repo currently schedules the automation once daily at 03:00.

If you need a more frequent cadence, change `vercel.json` deliberately and keep this runbook aligned with that change.

## Evidence Command

You can capture before/after automation evidence with:

`npm run ops:invoice-check -- <mode> <limit>`

Example:

`npm run ops:invoice-check -- live 25`

Required env for this command:

- `APP_URL` (or `AUTH_URL`)
- `INVOICE_CRON_SHARED_SECRET` (or `CRON_SECRET`)

## Readiness Command

Before rollout, check environment/config readiness with:

`npm run ops:invoice-readiness`

Example:

`npm run ops:invoice-readiness`

This verifies:

- app base URL env
- cron auth secret env
- SMTP env
- scheduler config presence in `vercel.json`

For tenant go-live readiness, use:

`npm run tenant:readiness -- --tenant-id <tenant-id>`

This verifies:

- tenant exists
- tenant live Mollie credentials exist
- tenant e-Boekhouden credentials exist
- tenant billing/accounting settings are complete
- tenant subscription-policy defaults exist

## Backlog Report Command

For exact failed/unsent row IDs during rollout and live cleanup:

`npm run ops:invoice-backlog -- <mode> <limit>`

Example:

`npm run ops:invoice-backlog -- live 50`

This prints:

- failed first-payment rows + retry-safe classification
- failed recurring rows + retry-safe classification
- invoice-created but unsent delivery rows (first-payment + recurring)
- permanent delivery failure flags
- last cron heartbeat fields

## Self-Heal Command

For controlled cleanup in one flow:

`npm run ops:invoice-self-heal -- <mode> [--apply-requeue] [--run-cron-check]`

Examples:

- dry run only:
  `npm run ops:invoice-self-heal -- live`
- apply safe requeue + trigger cron evidence check:
  `npm run ops:invoice-self-heal -- live --apply-requeue --run-cron-check`

## Go-Live Gate Command

For pass/fail automation gates (cron health + backlog thresholds), run:

`npm run ops:invoice-gate -- <mode> <limit> <maxUnresolvedAlerts> <maxPermanentFailures> <maxDueDeliveryRetries>`

Example:

`npm run ops:invoice-gate -- live 25 5 0 10`

Environment overrides are supported:

- `INVOICE_GATE_MAX_UNRESOLVED_ALERTS`
- `INVOICE_GATE_MAX_PERMANENT_FAILURES`
- `INVOICE_GATE_MAX_DUE_DELIVERY_RETRIES`

## One-Command Autonomy Report

Run combined readiness + backlog + gate evidence:

`npm run ops:invoice-autonomy-report -- <mode> <backlogLimit> <gateLimit>`

Example:

`npm run ops:invoice-autonomy-report -- live 50 25`

This command returns a single JSON report with:

- readiness section
- backlog section
- gate section
- `overallPass` boolean for rollout decision

## Scheduler Wiring

- Vercel deployments use [`vercel.json`](../../vercel.json) cron config.
- The cron route accepts both `POST` and `GET`.
- Auth accepts either:
  - `Authorization: Bearer <INVOICE_CRON_SHARED_SECRET>`
  - `Authorization: Bearer <CRON_SECRET>`

## Test-Run Safety

Before live customer delivery test:

1. Set `INVOICE_EMAIL_OVERRIDE_TO` to test mailbox.
2. Run cron in `mode=test` and confirm:
   - invoices created
   - emails routed only to override mailbox
   - intended recipients visible in metadata/audit.
3. Remove override env for normal customer delivery.

## Controlled Retry For `invoice_failed` Recurring Rows

Use `/settings` action: **Queue controlled retry for failed recurring invoices**.

Guardrails:

- Only rows still in `invoice_failed`.
- Only rows without stored e-Boekhouden invoice id/number.
- Only rows with safe known validation failure codes (`FACT_014`, `FACT_VERWERK_004`).

This prevents blind retries after unknown/network errors where upstream invoice state might be uncertain.

CLI fallback (dry-run by default):

`npm run ops:invoice-requeue-safe-failed -- <mode>`

Apply changes:

`npm run ops:invoice-requeue-safe-failed -- <mode> --apply`

Example:

`npm run ops:invoice-requeue-safe-failed -- live --apply`

## Live Cutover Checklist (Override -> Real Recipients)

1. Confirm SMTP delivery and invoice content in override mailbox.
2. Confirm metadata/audit shows:
   - intended recipient (`invoiceIntendedRecipient` / `invoiceDeliveryIntendedRecipient`)
   - effective recipient (`invoiceDeliveryRecipient` / `invoiceDeliveryEffectiveRecipient`)
3. Verify zero unresolved critical/warning alerts for invoice creation/delivery.
4. Remove `INVOICE_EMAIL_OVERRIDE_TO` from live environment.
5. Trigger one controlled live invoice send and verify:
   - real customer receives message
   - only one customer invoice email is sent per delivery attempt (with PDF attached when available, otherwise link fallback)
   - invoice_sent_at set
   - audit entry marks `recipientOverridden = false`.
6. Keep cron enabled; monitor first 24h for delivery failures.
