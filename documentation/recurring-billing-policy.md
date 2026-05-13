# Recurring Billing Policy

## Purpose

Canonical current-state policy for recurring invoice timing, direct-debit notice, failed collection handling, and the EUR 0.01 `mandate_only` flow.

This file is normative for implementation. Keep it aligned with code changes.

## Scope

This policy governs the customer-visible recurring billing flow that sits on top of the subscription contract.

This file does not replace `documentation/subscription-policy.md`.

Use this split:

- `documentation/subscription-policy.md`: subscription terms, consent, cancellation disclosure, term mode, service-end semantics
- `documentation/recurring-billing-policy.md`: recurring invoice notice timing, direct-debit collection handling, failed collection handling, mandate-only setup behavior

Do not treat accounting configuration as policy. The following belong in tenant billing settings, not here:

- e-Boekhouden `templateId`
- e-Boekhouden `emailTemplateId`
- ledger or product mappings
- VAT configuration
- invoice numbering preferences

## Locked Product Decisions

- Mollie remains the collection engine and payment source of truth.
- e-Boekhouden is the invoice and accounting engine.
- V1 recurring invoices are sent only for recurring subscriptions, not for one-off invoices.
- V1 recurring invoices are sent before automatic collection.
- V1 uses the invoice email as the customer-facing pre-notification for the upcoming direct debit.
- V1 default pre-notification lead time is 5 calendar days before the debit due date.
- The shorter-than-default SEPA pre-notification timeline must be agreed with the customer in the terms and consent flow.
- V1 invoice wording must clearly state that the amount will be collected automatically on the stated date.
- `real_installment` remains the default first-payment mode.
- `mandate_only` remains available only for mandate setup before recurring charges start.
- The EUR 0.01 `mandate_only` payment is not a normal subscription installment and is not a recurring invoice event.

## Canonical Billing Terms

- `invoice_notice_days_before_due_date`: customer-visible number of calendar days between invoice send and planned debit date
- `planned_collection_date`: the target date shown to the customer for automatic collection
- `failed_collection_state`: operational interpretation of a recurring collection outcome after reconciliation with Mollie
- `mandate_only`: a setup flow that establishes charge permission without counting as a normal subscription installment

## V1 Customer-Facing Billing Rules

- The recurring invoice must state the amount and the planned collection date.
- The recurring invoice must clearly say that the amount will be collected automatically.
- The recurring invoice email may serve as the direct-debit pre-notification.
- The default V1 pre-notification lead time is 5 calendar days before the planned collection date.
- Because the SEPA Core default pre-notification timeline is 14 calendar days unless another timeline is agreed, V1 must disclose and agree the shorter 5-day timeline in the customer terms and consent flow.
- The consent snapshot should capture that recurring invoices are sent before automatic collection and that the debit happens on the planned collection date.
- Customer-facing wording should avoid promising immediate settlement finality for SEPA direct debit because a debit can still fail or be reversed later.

## V1 Failed Collection Policy

### 1. Pending Window

- A recurring SEPA direct debit in `pending` state is not, by itself, a failed collection.
- V1 must not treat a payment as failed only because it stayed pending for 2 to 3 days.
- The billing and operations layers should allow a pending window through the normal SEPA return cycle before escalating a failure assumption.
- Unless Mollie already returned a definitive failed status, V1 should avoid treating a SEPA Core recurring debit as failed before the normal D+5 return window has passed.
- During the pending window:
  - the already-sent invoice remains valid
  - no duplicate invoice is created
  - no customer dunning or collection-fee flow is started automatically

### 2. First Ordinary Failed Collection

- If Mollie confirms that a recurring collection failed or was returned, the invoice remains open.
- V1 must not create a second invoice automatically for the same billing period.
- V1 must not automatically cancel the subscription after the first ordinary failed collection.
- V1 must open an operator alert and require review.
- V1 must not automatically add reminder fees, collection fees, or penalty fees.
- V1 may later implement a recovery flow, but V1 should treat the first failure as an operator-handled exception.

### 3. Repeated Failure Or Mandate Problem

- If the failure reason indicates that the mandate or bank account is no longer usable, future automatic collection on the current mandate must not be treated as safe.
- Examples include:
  - closed account
  - invalid account details
  - direct debit blocked on the account
  - no valid mandate
- In these cases, the business should require a new mandate or an alternative payment path before relying on future recurring collection.
- Repeated ordinary failures should move the customer into manual recovery handling rather than unlimited silent retries.

### 4. Chargeback Or Refund Reversal

- A SEPA Core reversal or dispute is higher severity than an ordinary failed collection.
- An authorised SEPA Core debit can still be reversed by the customer through the bank within 8 weeks.
- An unauthorised SEPA Core debit can be challenged for much longer through the bank claim process.
- The underlying invoice or contractual payment obligation does not disappear automatically because the customer reversed the debit through the bank.
- V1 must treat disputes or reversals as critical review events.
- V1 must not assume the collected money is final merely because the payment once appeared as paid.

### 5. Service And Subscription State

- Failed collection policy must not redefine subscription term semantics.
- A failed collection does not, by itself, change `subscription_term_mode`, `total_payments`, or `cancellation_effect`.
- V1 should not derive immediate service termination from a first failed collection alone.
- Service continuation or suspension after failed collection remains an operator decision until a fuller entitlement policy is implemented.

## V1 Policy For EUR 0.01 `mandate_only`

- The EUR 0.01 `mandate_only` payment exists to establish or verify the mandate before recurring charges start.
- It is not counted as a normal subscription installment.
- It must not be included in `total_payments`.
- It must not trigger the normal recurring pre-debit invoice flow.
- V1 should not send a normal recurring invoice for the EUR 0.01 setup payment.
- Customer-facing copy must describe the EUR 0.01 payment as mandate setup or verification, not as the first recurring invoice.
- Customer-facing copy must make clear that the actual recurring subscription starts later and separately.
- V1 keeps recurring subscription activation after `mandate_only` as an explicit operator step, not an automatic post-payment action.

## Consent And Terms Requirements

- The customer terms and consent flow must disclose the recurring invoice timing before automatic collection.
- The customer terms and consent flow must disclose that the agreed shorter pre-notification timeline is 5 calendar days before debit.
- The customer terms and consent flow must disclose that SEPA Core direct debits may still fail or be reversed and that the underlying payment obligation can remain due.
- For `mandate_only`, the customer terms and consent flow must disclose that the EUR 0.01 setup payment is separate from the actual subscription billing cycle.

## Out Of Scope / Not In V1

- Automatic customer dunning orchestration
- Automatic collection-fee charging
- Automatic legal collections escalation
- Per-subscription billing notice overrides
- Automated entitlement suspension logic
- Alternative country-specific direct-debit schemes outside the current NL and EUR-first baseline

## Forward-Compatibility Notes

- Future recovery flows may automate reminders, retries, or recovery links, but they must preserve the rule that a failed collection does not create duplicate invoices for the same billing period.
- Future tenant settings may make the pre-notification lead time configurable, but V1 should treat 5 calendar days as the canonical default.
- If customer self-serve billing recovery is added later, it must preserve the distinction between:
  - invoice state
  - payment collection state
  - subscription term state
  - service entitlement state
