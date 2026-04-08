# v0 Project Rules

Generate UI for an internal operations app called Mollie Manager.

## Product Context

- This is not a marketing site.
- This is a single-operator internal backoffice.
- The app manages Mollie subscription onboarding and ongoing subscription operations.
- The key workflow is: customer -> first payment -> mandate readiness -> subscription -> monitoring.
- Money-related actions must feel safe and deliberate.

## UI Direction

- Use `shadcn/ui` primitives where practical.
- Prefer calm, high-density, operator-first layouts.
- Visual references: Mollie dashboard, Render, Cloudflare, PayRequest.
- Use light, neutral surfaces with restrained accent color.
- Make important actions and states obvious without clutter.
- Keep layouts full-width on desktop.
- Avoid decorative hero sections and promotional copy.
- Avoid all-caps labels with wide letter spacing.
- Avoid oversized cards nested inside more cards.
- Prefer tables, lists, drawers, sheets, dialogs, and focused work surfaces.

## Component Rules

- Generate code that fits a Next.js App Router app.
- Prefer `components/ui/*` for reusable primitives.
- Keep feature-specific composition in route files or app-specific components.
- Use semantic, readable typography.
- Use concise labels and helper text.
- Keep status styling compact and readable.

## Domain Rules

- Do not redesign away safety confirmations for destructive or money-impacting actions.
- Keep test/live environment awareness visible, but do not make the UI feel like a developer console.
- Preserve the distinction between subscription onboarding and standalone payment links.
- Keep alerting, failures, disputes, and out-of-sync states visually clear.

## Output Preference

- Favor implementation-ready React/Next code.
- Favor shadcn-based layouts over custom one-off primitives.
- Keep imports realistic for this repo:
  - `@/components/ui/...`
  - `@/components/...`
  - `@/lib/...`
- If a page is being redesigned, optimize for readability, scanning, and workflow completion first.
