# Subscription Roadmap

Status: future direction
Audience: product and engineering

## Purpose

Future-state notes for subscription-platform evolution. This file is not the current implementation spec.

For active autonomous development order, use `implementation-roadmap.md`.

## Near-Term Shared Multi-Tenant Pilot Foundation

- make tenant-owned subscription policy defaults a first-class settings surface
- keep normal authenticated operator routes on standard product URLs rather than
  tenant namespaced paths
- resolve tenant context from authenticated session selection for operator flows
- resolve tenant context from onboarding token and linked state for public
  hosted consent/return flows
- store tenant-owned cancellation text, terms versioning, and default policy
- preserve broad SaaS administration as later scope

## Later Subscription-Platform Evolution

- add per-subscription policy overrides on top of the tenant default
- add customer self-serve cancellation as a stronger alternative to email-only
  cancellation
- add richer service-entitlement rules where service end is derived from a
  priced service period rather than entered directly
- improve the UI/UX of the customer-facing hosted onboarding return/success
  screen after Mollie checkout, including clearer success/pending states, better
  mandate-only messaging, and stronger branded reassurance while backend
  activation is still confirming
- add scheduled reconciliation so missed, delayed, or failed webhooks do not
  leave Mollie-backed subscription and payment state stale indefinitely
  Future implementation note: if Vercel cron remains unavailable on the current
  plan, run this via a Cloudflare Worker cron trigger that calls a protected
  reconciliation endpoint in the app.
- improve customer invoice email templates/branding and operator observability
  for app-owned delivery
- add provider abstraction if replacing SMTP delivery with Resend later
- hide or remove redundant internal billing labels from the settings UI once
  e-Boekhouden dropdown mappings are stable

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
