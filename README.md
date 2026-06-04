# Mollie Manager

Mollie Manager is an internal backoffice for managing Mollie subscription onboarding, recurring billing operations, invoice creation, and reliability workflows.

This app is built for a single operator. Mollie remains the payment source of truth. e-Boekhouden remains the invoice and accounting source of truth. The local PostgreSQL database is the operational layer that ties onboarding, reconciliation, alerts, audit logging, and invoice automation together.

## Core Workflow

1. Create or import a customer.
2. Create a first-payment link.
3. Send the customer through the hosted consent flow.
4. Let Mollie establish the mandate and complete the first payment.
5. Sync customer, mandate, payment, and subscription state.
6. Manage recurring billing, invoice creation, alerts, and repair flows.

## Stack

- Next.js 16 App Router
- React 19
- NextAuth v5 beta with Google sign-in allowlist
- PostgreSQL
- Drizzle ORM and Drizzle migrations
- Mollie API
- e-Boekhouden REST API
- Nodemailer for alert and invoice delivery
- Tailwind CSS v4 and shadcn/ui

## Main Areas

- `app/`: routes, API endpoints, and server-rendered UI surfaces
- `components/`: app components and `components/ui/*` primitives
- `lib/`: auth, billing, onboarding, Mollie, e-Boekhouden, reliability, and formatting logic
- `db/`: Drizzle schema, generated migrations, and migration metadata
- `scripts/`: database, readiness, backlog, and invoice-automation operations scripts
- `documentation/`: project docs, policies, runbooks, and archived notes

## Local Start

1. Copy `.env.example` to `.env` and fill in the required values.
2. Apply database migrations:
   `npm run db:apply`
3. Start the dev server:
   `npm run dev`
4. Open `http://localhost:3000`

Useful checks:

- `npm run lint`
- `npm run typecheck`
- `npm run test:node`
- `npm run build`

## Documentation

Start with [documentation/README.md](documentation/README.md).

The most important active docs are:

- [documentation/architecture/overview.md](documentation/architecture/overview.md)
- [documentation/development/setup.md](documentation/development/setup.md)
- [documentation/product/feature-inventory.md](documentation/product/feature-inventory.md)
- [documentation/product/subscription-policy.md](documentation/product/subscription-policy.md)
- [documentation/product/recurring-billing-policy.md](documentation/product/recurring-billing-policy.md)
- [documentation/operations/invoice-automation-runbook.md](documentation/operations/invoice-automation-runbook.md)

## Notes

- This repo uses `next@16` and `next-auth@5 beta`. Do not proactively read `node_modules/next/dist/docs/`. Only consult the specific relevant file there if you are changing framework-level behavior and the current API semantics are uncertain.
- `AUTH_SECRET` is required in every deployed environment; the app now fails closed if it is missing.
- In `APP_ENV=test`, live Mollie mode is intentionally blocked even if live credentials are present.
