# First Payment Invoice Plan

## Purpose

Detailed implementation plan for invoicing the paid first installment in e-Boekhouden without mixing it into the recurring pre-collection invoice flow.

This document is a working implementation plan, not a completed-state description.

## Problem Summary

Current behavior is correct for recurring subscription periods, but incomplete for the initial paid first installment.

Today:

- Mollie is the payment collection source of truth.
- e-Boekhouden is the invoice/accounting source of truth.
- Recurring invoice creation now works off `recurring_billing_schedules`.
- `recurring_billing_schedules` only models recurring subscription periods and pre-collection invoice timing.
- The initial paid first payment is stored as `payments.payment_type = 'first'`.
- That first payment is not represented in `recurring_billing_schedules`.

Result:

- A customer who used `firstPaymentMode = real_installment` can have:
  - first paid installment in Mollie
  - active subscription in Mollie
  - recurring invoice flow ready for later subscription periods
- but still no e-Boekhouden invoice for the first real installment.

This is not just a legacy-data problem. It is a current product gap.

## Important Product Rules

- Do not put first-payment invoicing into `recurring_billing_schedules`.
- Do not treat the first paid installment as a recurring pre-notification invoice.
- Do not create invoices for `firstPaymentMode = mandate_only`.
- Do not let e-Boekhouden send customer emails.
- Do not add customer invoice email delivery in the same change unless the invoice creation flow is already solid.
- Use official e-Boekhouden Swagger docs only for endpoints and payloads.

## Why This Must Be Separate

`recurring_billing_schedules` is specifically for:

- planned future collection dates
- recurring subscription billing periods
- invoice-before-automatic-collection behavior

The initial first payment is different:

- it happens before the recurring subscription cycle is underway
- it may be paid before the subscription record even exists
- it is not a pre-notification for a future automatic collection
- it should not inherit recurring direct-debit wording

So the first payment needs its own invoice flow and its own duplicate protection.

## Recommended Scope

Implement first-payment invoicing in two phases.

### Phase 1: Safe Manual Backfill + Manual Operator Action

Goal:

- cover already-paid first payments that should have an e-Boekhouden invoice
- allow operators to create missing invoices safely
- avoid automatic upstream invoice creation until the flow is proven

### Phase 2: Automatic Creation For New Paid First Payments

Goal:

- create the first-payment invoice automatically after confirmed paid first payment
- only when billing settings are complete and behavior is explicit

Phase 1 should land first.

## Recommended Data Model

Recommended pragmatic approach for v1:

- add first-payment invoice tracking columns directly to `payments`
- use them only for `payment_type = 'first'`
- keep recurring invoice tracking on `recurring_billing_schedules`

Recommended new `payments` columns:

- `invoice_state` using a dedicated payment-invoice enum:
  - `not_applicable`
  - `pending_invoice`
  - `invoice_creating`
  - `invoice_created`
  - `invoice_sent`
  - `invoice_failed`
  - `skipped`
- `eboekhouden_invoice_id`
- `eboekhouden_invoice_number`
- `invoice_created_at`
- `invoice_sent_at`
- `invoice_failed_at`

Recommended defaults:

- `payment_type = 'first'`:
  - `real_installment` -> `pending_invoice` once the payment is confirmed paid
  - `mandate_only` -> `skipped` or `not_applicable`
- all other payment types:
  - `not_applicable`

Why this approach:

- simple to query
- one first payment maps to one invoice
- easy duplicate protection with `payment.id`
- easy manual backfill of existing paid first payments
- lower risk than introducing a new generalized invoice-events table right now

Longer-term alternative:

- a shared `billing_invoice_events` table could unify recurring and first-payment invoice tracking later
- do not do that in the first pass unless more invoice types are entering scope

## Eligibility Rules For First-Payment Invoice Creation

An invoice should be creatable only when all of this is true:

- `payments.payment_type = 'first'`
- payment belongs to selected Mollie mode
- payment status is confirmed paid
- related customer has `eboekhouden_relation_id`
- tenant billing settings are complete
- related onboarding consent exists
- `first_payment_mode = 'real_installment'`
- no existing `eboekhouden_invoice_id`
- no existing `eboekhouden_invoice_number`
- current `invoice_state = 'pending_invoice'`

An invoice must not be created when:

- `first_payment_mode = 'mandate_only'`
- payment is unpaid, pending, failed, canceled, or expired
- customer is not linked to e-Boekhouden
- invoice already exists or row is already claimed

## Invoice Timing Rule

Recommended rule:

- create the first-payment invoice after the first payment is confirmed `paid`

Why:

- avoids creating accounting invoices for abandoned or unpaid payment links
- fits current "Mollie payment truth first, e-Boekhouden invoice truth second" behavior
- avoids open unpaid upstream invoices for incomplete onboarding attempts

This invoice is not the recurring pre-notification invoice.

## Invoice Content Rule

For the first-payment invoice:

- invoice date should be the paid first payment date or the payment created date, based on explicit product choice
- recommended default: use `paid_at` date if available, otherwise `created_at`
- invoice line description should come from the subscription description already captured in onboarding consent / payment metadata
- revenue ledger should use the selected tenant billing setting
- VAT should use the existing 21% setting
- do not use recurring direct-debit wording
- do not describe it as a planned future automatic collection

Reference should clearly identify the first-payment event, for example:

- `First payment {payment_id}`
- optionally include customer or consent context for operator traceability

## Duplicate Protection

This is the most important requirement.

Use the same claim-before-upstream-call pattern as recurring invoices.

Recommended flow:

1. operator action or automated path selects eligible first-payment rows
2. row is atomically updated from `pending_invoice` to `invoice_creating`
3. only claimed rows may call e-Boekhouden
4. success updates:
   - `invoice_state = invoice_created`
   - store e-Boekhouden invoice id/number
5. failure updates:
   - `invoice_state = invoice_failed`
   - store error metadata
   - require manual review before retry

Do not call e-Boekhouden first and update the DB second.

## Recommended Queries

### Manual backfill candidate query

Candidate first-payment rows should join:

- `payments`
- `customers`
- `subscription_onboarding_consents` or linked consent context if needed

Candidate rules:

- `payments.mode = selected mode`
- `payments.payment_type = 'first'`
- `payments.mollie_status = 'paid'`
- customer linked to e-Boekhouden
- consent `first_payment_mode = 'real_installment'`
- invoice tracking fields empty
- invoice state pending

### Future automatic path trigger

Use the existing payment sync flow:

- when a first payment transitions to confirmed `paid`
- if consent says `real_installment`
- if invoice settings are complete
- queue or create first-payment invoice

## Implementation Sequence

### Step 1: Document The Policy Split

Update docs to state explicitly:

- recurring invoice flow covers recurring subscription periods only
- first paid installment invoicing is separate
- `mandate_only` first payment never creates a normal invoice

### Step 2: Add Payment Invoice State Model

Add new enum and `payments` columns for first-payment invoice tracking.

Migration tasks:

- add payment invoice enum
- add invoice state/id/number/timestamps columns
- backfill:
  - existing `payment_type = 'first'` paid rows tied to `real_installment` -> `pending_invoice`
  - existing `payment_type = 'first'` rows tied to `mandate_only` -> `skipped` or `not_applicable`
  - all other rows -> `not_applicable`

Backfill must use consent / metadata, not assumptions.

### Step 3: Add First-Payment Invoice Service

Create a dedicated service, for example:

- `lib/eboekhouden/first-payment-invoices.ts`

Responsibilities:

- select eligible first-payment invoice candidates
- claim invoice rows
- build e-Boekhouden payload
- create invoice via official Swagger-based client
- store invoice id/number
- write audit logs
- open operator alerts on success/failure
- optionally send operator alert email on failure

### Step 4: Add Manual Operator Action

Add a safe manual action first.

Recommended UI options:

- `/settings` card next to recurring invoice tools
- or a customer/payment-level operator action

Recommended initial control:

- `Create due first-payment invoices`

The button should show:

- current mode
- ready count
- blocked count

### Step 5: Add Failure Review Behavior

When invoice creation fails:

- set `invoice_state = invoice_failed`
- store error details in metadata
- open warning alert
- do not retry automatically

Retry should be a later explicit operator action, not an immediate loop.

### Step 6: Add Automatic Path For New Paid First Payments

After manual flow is stable:

- hook into first-payment sync after status becomes `paid`
- if consent `firstPaymentMode = real_installment`
- if settings complete
- create first-payment invoice automatically

Guardrails:

- only after confirmed paid
- same claim-state duplicate protection
- no customer email delivery yet

## Specific Legacy Case To Use As Acceptance Example

Use `Glorious Beauty` as the concrete acceptance example.

Expected completed state for that customer:

- first payment link payment has its own e-Boekhouden invoice
- recurring schedule row for `planned_collection_date = 2026-05-10` has its own recurring invoice
- total invoices represented in e-Boekhouden:
  - invoice for first real installment
  - invoice for first recurring automatic collection cycle

That is the business expectation the current app does not yet fully meet.

## Acceptance Criteria

### Phase 1 acceptance

- a paid `real_installment` first payment can receive an e-Boekhouden invoice via manual operator action
- a `mandate_only` first payment never appears as invoice-ready
- duplicate creation is prevented with claim-state locking
- invoice id and number are stored on the payment row
- audit logs exist for success and failure
- operator alerts exist for success and failure
- failure does not auto-retry
- no customer invoice email is sent yet

### Phase 2 acceptance

- new paid `real_installment` first payments create e-Boekhouden invoices automatically
- same duplicate guarantees still hold
- legacy manual backfill remains available for missing historical invoices

## Suggested Tests

### Happy path

- create a new onboarding flow with `real_installment`
- first payment becomes paid
- manual action creates one invoice
- second click does not create another invoice

### Mandate-only path

- create onboarding flow with `mandate_only`
- payment becomes paid
- no first-payment invoice candidate is created

### Missing customer link

- paid first payment exists
- customer has no `eboekhouden_relation_id`
- row shows as blocked, not actionable

### Failure path

- break template or ledger selection
- attempt invoice creation
- row becomes `invoice_failed`
- alert and audit entry are written

### Legacy backfill path

- old paid first payment with no invoice tracking
- migration/backfill marks it pending
- manual action creates missing invoice

## Open Questions To Decide In The Next Session

These should be decided explicitly before implementation:

1. Which date should the first-payment invoice use?
   Recommended default: `paid_at`, fallback `created_at`.

2. Should successful first-payment invoice creation open an `info` alert or only write audit logs?
   Recommended default: mirror recurring flow and keep success alerts for operator visibility.

3. Where should the manual operator action live?
   Recommended default: `/settings` first, customer/payment view later if needed.

4. Should automatic first-payment invoice creation be included in the same PR as the manual flow?
   Recommended default: no. Land manual/backfill first, then automatic.

## Recommended Next Session Prompt

Suggested next-session implementation goal:

`Implement phase 1 of documentation/first-payment-invoice-plan.md: add first-payment invoice tracking on payments, backfill eligible paid real_installment first payments to pending_invoice, build a safe manual e-Boekhouden first-payment invoice creation flow with claim-state duplicate protection, invoice id/number persistence, audit logs, and operator alerts. Do not implement customer email delivery.`
