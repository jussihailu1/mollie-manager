# Subscription Policy

## Purpose

Canonical current-state policy for subscription term handling, consent, cancellation disclosure, and future-safe data modeling.

This file is normative for implementation. Keep it aligned with code changes.

## Canonical Terms

- `subscription_term_mode`: `open_ended | fixed_term`
- `total_payments`: billing source of truth for `fixed_term`
- `last_charge_date`: derived or validated display/audit value, not the primary billing control
- `service_end_at`: end of entitlement/service access
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

## V1 Policy Rules

- Use `subscription_term_mode` as the only top-level term-mode field.
- `open_ended` means the subscription continues until canceled.
- `fixed_term` means the subscription has a bounded number of scheduled charges.
- For `fixed_term`, `total_payments` is required.
- `last_charge_date` may be entered by UI or shown by UI, but the implementation must resolve it into `total_payments`.
- `service_end_at` is independent from the final billing date.
- `cancellation_effect` governs what happens to service entitlement after cancellation, not how many charges exist.
- Default cancellation behavior remains "stop future charges after the current paid period" unless the tenant default policy says otherwise.

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
  - links or references to terms/privacy content
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

## Out Of Scope / Not In V1

- Per-subscription policy overrides
- Customer self-serve cancellation UI
- Generalized legal rule engine
- Full multi-tenant SaaS policy management

## Forward-Compatibility Notes

- Current implementation work should assume a tenant default policy exists conceptually, even if the first pass stores a single app-wide default.
- Future policy override support must extend the current model, not replace the meaning of `subscription_term_mode`, `total_payments`, `service_end_at`, or `cancellation_effect`.
