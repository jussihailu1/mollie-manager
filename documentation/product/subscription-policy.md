# Subscription Policy

Status: canonical
Audience: product and engineering

## Purpose

Canonical current-state policy for subscription term handling, consent, cancellation disclosure, and future-safe data modeling.

This file is normative for implementation. Keep it aligned with code changes.

Customer-visible recurring invoice timing, direct-debit notice, failed collection handling, and the EUR 0.01 mandate-setup flow are defined separately in `recurring-billing-policy.md`.

## Canonical Terms

- `subscription_term_mode`: `open_ended | fixed_term`
- `total_payments`: billing source of truth for `fixed_term`
- `last_charge_date`: derived or validated display/audit value, not the primary billing control
- `service_end_at`: end of entitlement or service access
- `cancellation_effect`: `immediate | end_of_paid_period`

## Locked Product Decisions

- NL first and EUR first remain baseline assumptions.
- This feature set must align with EU and Dutch consumer expectations.
- V1 supports cancellation by email as the customer-facing online cancellation channel.
- V1 must disclose the cancellation email address before the customer starts the subscription.
- V1 must not use pre-ticked consent checkboxes.
- Consent must be tied to the exact subscription terms shown to the customer.
- The billing end concept and the service end concept are separate and must stay separate in the model.
- Do not introduce overlapping policy fields that encode the same meaning twice.
- V1 supports `first_payment_mode: real_installment | mandate_only`.
- `real_installment` remains the default first-payment mode.
- `mandate_only` in V1 is fixed at `EUR 0.01` and is used only for mandate setup before recurring charges.
- Customer-visible recurring billing notice rules must stay separate from accounting configuration such as invoice templates, email templates, VAT, and ledger mapping.

## V1 Policy Rules

- Use `subscription_term_mode` as the only top-level term-mode field.
- `open_ended` means the subscription continues until canceled.
- `fixed_term` means the subscription has a bounded number of scheduled charges.
- For `fixed_term`, `total_payments` is required.
- `total_payments` is customer-visible charge count:
  - for `real_installment`, include the first payment
  - for `mandate_only`, exclude the `EUR 0.01` mandate setup payment
- `last_charge_date` may be entered by UI or shown by UI, but the implementation must resolve it into `total_payments`.
- `service_end_at` is independent from the final billing date.
- `cancellation_effect` governs what happens to service entitlement after cancellation, not how many charges exist.
- Default cancellation behavior remains "stop future charges after the current paid period" unless the tenant default policy says otherwise.
- Fixed-term validation minimums:
  - `real_installment` requires `total_payments >= 2`
  - `mandate_only` requires `total_payments >= 1`

## V1 Onboarding Flow Shape

- The customer must see the subscription terms before entering Mollie checkout.
- The terms shown must include:
  - amount
  - billing interval
  - whether the subscription is `open_ended` or `fixed_term`
  - `total_payments` or final charge framing
  - service end behavior
  - cancellation method
  - cancellation email address
  - links or references to terms and privacy content
- If the recurring billing notice timing is part of the customer promise, the terms shown must also include the recurring invoice timing and automatic collection framing defined in `recurring-billing-policy.md`.
- The customer must actively accept the required consent checkboxes.
- Consent evidence must be stored with a snapshot of the shown terms.
- The mandate-establishing first payment remains part of the flow, but the customer-facing entrypoint should become the app-hosted consent screen rather than a raw Mollie checkout URL.

## V1 Data Model Expectations

- Store `subscription_term_mode`.
- Store `total_payments` for fixed-term subscriptions.
- Store `last_charge_date` only as derived, validated, or audit-facing data.
- Store `service_end_at` separately from billing fields.
- Store `cancellation_effect`.
- Store consent evidence with:
  - terms version
  - accepted checkbox set
  - acceptance timestamp
  - customer-facing plan snapshot
- Add tenant-level default policy storage now if needed by implementation, but do not implement per-subscription overrides yet.

## Operator Subscription Operations Foundation

The first operator-operations slice is intentionally policy-only. No pause,
resume, or cancellation control may call Mollie until durable intent,
idempotency, effective-date execution, and audit persistence exist.

| Operation | Current decision | Billing effect | Service effect |
| --- | --- | --- | --- |
| Cancel active open-ended subscription | allowed only with an operator reason and valid effective date | stop future Mollie charges at the effective date; keep existing invoices and payment collection state unchanged | `immediate` ends service at the effective date; `end_of_paid_period` requires and preserves service through the paid-period end |
| Cancel fixed-term subscription | blocked as `fixed_term_policy_undefined` | none | none |
| Pause | blocked as `provider_operation_unsupported` | none | none |
| Resume | blocked as `provider_operation_unsupported` | none | none |

Additional rules:

- Mollie cancellation is irreversible and is not a reversible pause.
- A future effective date requires durable scheduling; the provider must not be
  cancelled early.
- A terminal, completed, already-cancelled, or future-charges-stopped
  subscription rejects another operation.
- Fixed-term cancellation remains blocked because stopping Mollie early would
  change the agreed `total_payments` obligation. `cancellation_effect` controls
  service entitlement and does not answer that billing decision.
- Cancellation never settles, voids, retries, or duplicates an existing invoice
  or payment, and never changes failed-payment collection state.
- `future_charges_stopped` is a cancellation/billing-end signal, not a paused
  state that can be resumed.
- Operator intent is stored in the typed `subscription_operation_requests`
  model before any future provider call. It records operation, status, reason,
  effective date, paid-period end, cancellation-effect snapshot, policy result,
  provider-mutation requirement, and lifecycle timestamps without JSONB.
- At most one unresolved `pending`, `scheduled`, or `processing` request may
  exist for the same subscription and operation.

## Out Of Scope / Not In V1

- Per-subscription overrides
- Customer self-serve cancellation UI
- Generalized legal rule engine
- Full multi-tenant SaaS policy management

## Forward-Compatibility Notes

- Current implementation work should assume a tenant default policy exists conceptually, even if the first pass stores a single app-wide default.
- Future policy override support must extend the current model, not replace the meaning of `subscription_term_mode`, `total_payments`, `service_end_at`, or `cancellation_effect`.
