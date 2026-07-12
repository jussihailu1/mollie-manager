# Recurring Billing Policy

Status: canonical
Audience: product and engineering

## Purpose

Canonical current-state policy for recurring invoice timing, direct-debit notice, failed collection handling, and the EUR 0.01 `mandate_only` flow.

This file is normative for implementation. Keep it aligned with code changes.

## Scope

This policy governs the customer-visible recurring billing flow that sits on top of the subscription contract.

This file does not replace `subscription-policy.md`.

Use this split:

- `subscription-policy.md`: subscription terms, consent, cancellation disclosure, term mode, service-end semantics
- `recurring-billing-policy.md`: recurring invoice notice timing, direct-debit collection handling, failed collection handling, mandate-only setup behavior
- `multi-tenant-pilot-scope.md`: shared-app tenant scope and release boundaries

Do not treat accounting configuration as policy. The following belong in tenant billing settings, not here:

- active invoice provider
- e-Boekhouden `templateId`
- ledger or product mappings
- VAT configuration
- invoice numbering preferences
- internal display labels for selected accounting mappings

## Tenant Scope And Settings Ownership

- Customer-facing recurring billing behavior runs inside one tenant context.
- Recurring billing notice wording, planned collection wording, failed-payment
  customer notifications, and billing/accounting defaults must be resolved from
  the active tenant's configuration and stored evidence.
- A tenant's later billing-setting changes must not silently rewrite the meaning
  of previously accepted consent or previously issued invoice evidence.
- Platform-wide SMTP may remain shared for the pilot, but shared delivery
  infrastructure does not make the billing policy app-wide.

## Locked Product Decisions

- Mollie remains the collection engine and payment source of truth.
- One explicit active invoice provider is selected per tenant for new invoices.
- V1 recurring invoices are sent only for recurring subscriptions, not for one-off invoices.
- V1 recurring invoices are sent before automatic collection.
- V1 uses the invoice email as the customer-facing pre-notification for the upcoming direct debit.
- V1 default pre-notification lead time is 5 calendar days before the debit due date.
- The shorter-than-default SEPA pre-notification timeline must be agreed with the customer in the terms and consent flow.
- V1 invoice wording must clearly state that the amount will be collected automatically on the stated date.
- The provider that created a recurring invoice owns invoice truth for that invoice row; customer email delivery may be app-owned and must not change invoice truth.
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
- For the shared multi-tenant pilot, the wording and timing shown to the customer
  must come from the tenant-owned consent/policy snapshot tied to that customer
  flow, not from one mutable app-wide live default.

## V1 Failed Collection Policy

Implementation note: payment outcome classification starts in pure helpers before
side effects. The classifier uses Mollie-synced payment state, refund/chargeback
amount signals, mandate usability signals, status reasons, and the safe pending
window to produce plain operational states: `pending`, `paid`, `failed`,
`reversed`, `charged_back`, `mandate_problem`, or `needs_review`.

Customer notification copy is composed in an isolated helper and must only be
sent after classification allows customer notification. The default copy avoids
threat, penalty, cancellation, and automatic escalation language.

Failed-payment customer notification delivery uses typed claim-before-send
persistence keyed by payment and notification type. A sync pass must not send
the same failed-payment customer notification more than once for the same local
payment. Notification records store delivery status and minimal outcome evidence,
not raw Mollie payloads or secrets.

Failed or abandoned delivery claims use bounded recovery. A failed attempt may
be reclaimed only after the retry delay and below the maximum attempt count; a
stale in-progress claim may be reclaimed after its lease timeout. Sent and
skipped rows are terminal. Each attempt has a claim token, so only the current
lease may mark that attempt sent or failed. Recovery reuses the same notification
row and never creates another invoice or changes customer/subscription state.

Normal operator attention items should show classified failed payments with a
manual safe next action. They may recommend review, mandate renewal, or checking
Mollie/e-Boekhouden, but must not recommend automatic cancellation, fees, or
dunning as the default action.

Failed-payment customer communications must stay tenant-scoped. No customer
notification flow may mix tenant contact paths, tenant terms, or tenant provider
evidence across businesses.

The current persisted recurring collection enum remains the narrower storage
shape for compatibility. Plain outcomes are mapped into existing review states
until a later migration promotes the plain state model into durable columns and
operator surfaces.

### 1. Pending Window

- A recurring SEPA direct debit in `pending` state is not, by itself, a failed collection.
- V1 must not treat a payment as failed only because it stayed pending for 2 to 3 days.
- The billing and operations layers should allow a pending window through the normal SEPA return cycle before escalating a failure assumption.
- Unless Mollie already returned a definitive failed status, V1 should avoid treating a SEPA Core recurring debit as failed before the normal D+5 return window has passed.
- During the pending window:
  - the already-sent invoice remains valid
  - no duplicate invoice is created
  - no customer dunning or collection-fee flow is started automatically
- A pending recurring payment becomes `needs_review` only after the safe pending
  window has elapsed without a definitive Mollie settlement state.

### 2. First Ordinary Failed Collection

- If Mollie confirms that a recurring collection failed or was returned, the invoice remains open.
- V1 must not create a second invoice automatically for the same billing period.
- V1 must not automatically cancel the subscription after the first ordinary failed collection.
- V1 must open an operator alert and require review.
- V1 should notify the customer with plain, policy-safe wording that the payment did not succeed and that operator follow-up may be needed.
- V1 should create a normal operator task that explains the failed payment, relevant invoice, likely reason, and safe next action.
- V1 must not automatically add reminder fees, collection fees, or penalty fees.
- V1 may later implement a recovery flow, but V1 should treat the first failure as an operator-handled exception.
- Failure detection is separate from invoice creation and invoice delivery state.
  A failed collection keeps the existing period invoice open and must not create
  another invoice for that same billing period.

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
- A failed or expired `mandate_only` setup payment is classified as a
  `mandate_problem`, not as an ordinary missed subscription installment.

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
- Future recovery flows must separate detection and notification from consequences such as pause, cancellation, fees, dunning, or legal escalation.
- Future tenant settings may make the pre-notification lead time configurable, but V1 should treat 5 calendar days as the canonical default.
- Future tenant-specific SMTP overrides may change sender infrastructure, but
  they must not change the billing-policy separation between invoice/accounting
  truth and customer communication behavior.
- If customer self-serve billing recovery is added later, it must preserve the distinction between:
  - invoice state
  - payment collection state
  - subscription term state
  - service entitlement state
