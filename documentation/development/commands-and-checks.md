# Commands And Checks

Status: active reference
Audience: developers and operators

## Development

- `npm run dev`: start the Next.js dev server
- `npm run build`: production build
- `npm run start`: start the production server locally
- `npm run lint`: run ESLint
- `npm run typecheck`: run TypeScript without emitting files
- `npm run test:node`: run the Node test suite under `lib/**/*.test.ts`

## Database

- `npm run db:apply`: apply Drizzle migrations
- `npm run db:backfill-consent-tokens`: erase legacy plaintext consent tokens after the hashed-token migration is applied
- `npm run db:migrate`: alias for `db:apply`
- `npm run db:generate`: generate Drizzle migration files from schema changes
- `npm run db:smoke`: basic database smoke check
- `npm run db:check-raw`: validate raw SQL assumptions and migration state
- `npm run ops:retention-report -- [mode] [auditDays] [webhookDays] [consentDays]`: inspect retention exposure without changing data

## UI

- `npm run ui:add -- <component>`: add a shadcn/ui component

Example:

`npm run ui:add -- button`

## Invoice Automation Ops

- `npm run ops:invoice-check -- <mode> <limit>`: run automation evidence checks
- `npm run ops:invoice-readiness -- <mode>`: validate environment and scheduler readiness
- `npm run ops:invoice-backlog -- <mode> <limit>`: report failed and unsent invoice rows
- `npm run ops:invoice-gate -- <mode> <limit> <maxUnresolvedAlerts> <maxPermanentFailures> <maxDueDeliveryRetries>`: pass or fail automation gate
- `npm run ops:invoice-autonomy-report -- <mode> <backlogLimit> <gateLimit>`: combined readiness, backlog, and gate report
- `npm run ops:invoice-requeue-safe-failed -- <mode> [--apply]`: queue safe retry rows
- `npm run ops:invoice-self-heal -- <mode> [--apply-requeue] [--run-cron-check]`: controlled cleanup flow

## Retention And Compliance Ops

- `npm run ops:retention-report -- [mode] [auditDays] [webhookDays] [consentDays]`: read-only inventory of audit logs, webhook events, and consent evidence

Defaults:

- `mode`: `all`
- `auditDays`: `365`
- `webhookDays`: `180`
- `consentDays`: `365`

## Recommended Local Validation Before Shipping

Run these before finishing non-trivial changes:

1. `npm run lint`
2. `npm run typecheck`
3. `npm run test:node`
4. `npm run build`
