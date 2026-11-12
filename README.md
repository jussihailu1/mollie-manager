# Kify

Kify makes automatic direct debit (incasso) easy for businesses: customer consent and mandate setup, recurring collections, clear payment status, customer communication, and integrations that reduce administration. The repository retains its historical `mollie-manager` name.

The shared, manually provisioned multi-tenant foundation is in place. Mollie executes payments and remains payment truth; bookkeeping software maintains the accounts. Kify is the default invoice issuer for new tenants, and each stored invoice retains its original provider (`kify`, `eboekhouden`, or legacy `mollie`). PostgreSQL holds tenant-scoped operational state, consent, automation and recovery evidence.

Kify-owned invoicing is the current supporting implementation milestone: K1–K6 exist, while K7 controlled proof and K8 completion remain open. Mollie Connect's independent-merchant proof is also pending. Future-only e-Boekhouden receipt posting is released for the existing tenant; the first genuine automatic receipt remains unproved. Use the [roadmap](documentation/product/implementation-roadmap.md) for current order and the [receipt release record](documentation/operations/automatic-receipt-release-2026-11-12.md) for verified release status.

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
- NextAuth v5 beta with Google sign-in
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

1. Create a local `.env` using [development setup](documentation/development/setup.md), with an isolated development database. `.env.example` is not tracked in this checkout.
2. Review the target database and branch migration notes before applying migrations:
   `npm run db:apply`
3. Start the dev server:
   `npm run dev`
4. Open `http://localhost:3000`

Useful checks:

- `npm run lint`
- `npm run typecheck`
- `npm run test:node`
- `npm run build`
- `npm run tenant:provision -- --slug pilot --name "Pilot Tenant" --operator-email owner@example.com`

## Documentation

Start with [documentation/README.md](documentation/README.md).

The most important active docs are:

- [documentation/product/implementation-roadmap.md](documentation/product/implementation-roadmap.md)
- [documentation/operations/automatic-receipt-release-2026-11-12.md](documentation/operations/automatic-receipt-release-2026-11-12.md)
- [documentation/product/subscription-policy.md](documentation/product/subscription-policy.md)
- [documentation/product/recurring-billing-policy.md](documentation/product/recurring-billing-policy.md)
- [documentation/architecture/overview.md](documentation/architecture/overview.md)
- [documentation/development/setup.md](documentation/development/setup.md)
- [documentation/product/feature-inventory.md](documentation/product/feature-inventory.md)
- [documentation/product/multi-tenant-pilot-scope.md](documentation/product/multi-tenant-pilot-scope.md)
- [documentation/operations/invoice-automation-runbook.md](documentation/operations/invoice-automation-runbook.md)

## Notes

- This repo uses `next@16` and `next-auth@5 beta`. Do not proactively read `node_modules/next/dist/docs/`. Only consult the specific relevant file there if you are changing framework-level behavior and the current API semantics are uncertain.
- `AUTH_SECRET` is required in every deployed environment; the app now fails closed if it is missing.
- In `APP_ENV=test`, live Mollie mode is intentionally blocked even if live credentials are present.
