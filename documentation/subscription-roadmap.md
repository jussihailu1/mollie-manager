# Subscription Roadmap

## Purpose

Future-state notes for subscription-platform evolution. This file is not the current implementation spec.

## Future Direction

- Add tenant default policy management as a first-class settings surface.
- Add per-subscription policy overrides on top of the tenant default.
- Add customer self-serve cancellation as a stronger alternative to email-only cancellation.
- Add richer service-entitlement rules where service end is derived from a priced service period rather than entered directly.
- Add broader SaaS / multi-tenant positioning where each tenant owns its own cancellation text, terms versioning, and default policy.
- Improve the UI/UX of the customer-facing hosted onboarding return/success screen after Mollie checkout, including clearer success/pending states, better mandate-only messaging, and stronger branded reassurance while backend activation is still confirming.
- Add scheduled reconciliation so missed, delayed, or failed webhooks do not leave Mollie-backed subscription and payment state stale indefinitely.
  Future implementation note: if Vercel cron remains unavailable on the current plan, run this via a Cloudflare Worker cron trigger that calls a protected reconciliation endpoint in the app.
- Add app-owned recurring invoice email delivery using the existing SMTP stack first, with Resend as a later replacement option if needed.
- Implement first-payment e-Boekhouden invoicing for `real_installment` onboarding flows as a separate path from recurring pre-collection invoices.
  Detailed plan: `documentation/first-payment-invoice-plan.md`.
- Hide or remove redundant internal billing labels from the settings UI once e-Boekhouden dropdown mappings are stable.

## Constraints On Future Work

- Do not backfill future override behavior into V1 data or UI without an explicit product decision.
- Do not collapse service entitlement rules into billing-only fields.
- Do not remove email cancellation support unless a compliant replacement exists.

## Expected Later Additions

- Policy precedence model: platform default -> tenant default -> subscription override
- Customer-facing cancellation intake and status handling
- Tenant-owned consent text/version management
- Tenant-owned terms/privacy links and cancellation contact settings
- A reconciliation scheduler with clear scope, cadence, observability, and manual rerun support
