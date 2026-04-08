# v0 UI Brief

This is the focused UI brief to give v0 before asking for redesign work.

## App Sections

- Overview: operations home, not a brochure
- Customers: list + entry into onboarding workspace
- Customer detail: first payment, mandate sync, subscription creation
- Subscriptions: dense operations table with guarded actions
- Payments: operational ledger with exceptions emphasized
- Payment Links: separate from the recurring setup flow
- Alerts: triage queue
- Settings: lightweight admin and environment controls

## What Good Looks Like

- Easy to scan in 5 seconds
- Clear primary actions
- Clean visual rhythm
- Low clutter
- Strong hierarchy
- Minimal explanatory text
- Tables and summaries that prioritize operational decisions

## Current UX Problems To Correct

- too many custom presentation components
- too much developer-facing chrome
- width is constrained more than needed
- too many uppercase/tracked labels
- settings still reads like a setup console
- important actions and states are not focused enough

## High-Priority UI Targets

- full-width dashboard shell
- shadcn primitives as the default building blocks
- logo-triggered sidebar popover/menu for secondary account/app actions
- top-center test-mode indicator when test mode is active
- cleaner settings page
- alerts page as the place for sending a test alert
- denser tables and simpler section framing

## Design Guardrails

- Neutral light theme only for now
- Do not turn the app into a landing page
- Do not remove money/safety confirmations
- Do not hide critical state transitions
- Do not add noisy gradients or decorative visuals
- Keep the interface feeling serious, calm, and fast
