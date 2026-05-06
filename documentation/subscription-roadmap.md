# Subscription Roadmap

## Purpose

Future-state notes for subscription-platform evolution. This file is not the current implementation spec.

## Future Direction

- Add tenant default policy management as a first-class settings surface.
- Add per-subscription policy overrides on top of the tenant default.
- Add customer self-serve cancellation as a stronger alternative to email-only cancellation.
- Add richer service-entitlement rules where service end is derived from a priced service period rather than entered directly.
- Add broader SaaS / multi-tenant positioning where each tenant owns its own cancellation text, terms versioning, and default policy.

## Constraints On Future Work

- Do not backfill future override behavior into V1 data or UI without an explicit product decision.
- Do not collapse service entitlement rules into billing-only fields.
- Do not remove email cancellation support unless a compliant replacement exists.

## Expected Later Additions

- Policy precedence model: platform default -> tenant default -> subscription override
- Customer-facing cancellation intake and status handling
- Tenant-owned consent text/version management
- Tenant-owned terms/privacy links and cancellation contact settings
