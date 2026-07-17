# Subscription Roadmap

Status: archived on 2026-07-12
Audience: historical reference only

This file previously held future subscription-platform direction. Valid pending
items now live in `../product/implementation-roadmap.md`. Do not use this file
for development order.

## Historical Direction Preserved

- tenant-owned subscription-policy settings
- per-subscription policy overrides after tenant defaults
- customer self-service cancellation
- richer service-entitlement rules separate from billing state
- scheduled reconciliation and operational visibility
- improved customer invoice email branding
- optional delivery-provider abstraction
- policy precedence from platform default to tenant default to subscription override

Several earlier near-term items were implemented before archival, including
tenant context resolution, hosted consent/return flows, provider-neutral invoice
delivery, and scheduled tenant-aware reliability work. Git history contains the
full former document and implementation narrative.

## Historical Constraints Still Active Elsewhere

- Do not add per-subscription overrides without an explicit product decision.
- Do not collapse service entitlement into billing-only fields.
- Do not remove compliant cancellation contact support without a replacement.
- Mollie provider cancellation is not reversible pause.

Current policy lives in `../product/subscription-policy.md` and
`../product/recurring-billing-policy.md`.
