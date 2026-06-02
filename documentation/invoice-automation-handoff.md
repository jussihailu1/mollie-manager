# Invoice Automation Handoff

Use this file as handoff for next chat.

## Goal

Build complete, autonomous invoicing linked to payments.

## Current State

Built already:

- first-payment `real_installment` invoices auto-create after paid sync
- recurring due invoices auto-create via protected cron
- app-owned customer invoice email delivery
- `INVOICE_EMAIL_OVERRIDE_TO` test mailbox redirect
- invoice PDF attach or safe link fallback
- duplicate protection with claim lock + e-Boekhouden reconcile
- safe retry path for known e-Boekhouden ref-length errors
- cron health, backlog, readiness, gate, and self-heal ops scripts

Live state already cleaned:

- old failed recurring row `0c518851-07cf-457f-86d8-c920c3703438` requeued, then cleared
- backlog now clean:
  - failed first-payment = 0
  - failed recurring = 0
  - unsent invoice-created = 0
  - permanent delivery failures = 0

Validation already passed:

- `npm run typecheck`
- `npm run lint`
- `npm run db:check-raw`
- `npm run test:node`

## Core Rules

- Mollie payment truth first.
- e-Boekhouden invoice truth second.
- Do not let e-Boekhouden email customers.
- Customer invoice delivery stays app-owned.
- `mandate_only` first payment must never create normal invoice.
- First-payment flow stays separate from recurring flow.
- Recurring invoice is pre-notification before automatic direct debit.
- Default pre-notification lead time is 5 calendar days before collection.

## Remaining Work

The code is mostly done. What remains is external-state proof:

1. Set live env.
   - `APP_URL` or `AUTH_URL`
   - cron secret
   - SMTP env
   - `EBOEKHOUDEN_API_TOKEN`
   - `MOLLIE_DEFAULT_MODE=live`
2. Run readiness + gate + autonomy report in deployment context.
3. Verify cron heartbeat updates in `/api/health`.
4. Run override-mailbox end-to-end proof.
5. Remove override and do one real customer send.
6. Watch first 24h for no new backlog or delivery failures.

## Recommended Next Chat Flow

Do not jump ahead. Work one step at a time:

1. Check readiness.
2. Check backlog.
3. Check gate.
4. If any safe failed row exists, requeue it.
5. Run cron proof.
6. Test override mailbox.
7. Cut over to real recipients.

## Commands

- `npm run ops:invoice-readiness -- live`
- `npm run ops:invoice-backlog -- live 50`
- `npm run ops:invoice-gate -- live 25 5 0 10`
- `npm run ops:invoice-autonomy-report -- live 50 25`
- `npm run ops:invoice-self-heal -- live`
- `npm run ops:invoice-requeue-safe-failed -- live --apply`

## New Chat Prompt

Use this in next chat with model `5.4-mini` on `high`:

```text
Read documentation/invoice-automation-handoff.md first.

You are guiding me one step at a time until complete autonomous invoicing is proven end-to-end.

Current code already does:
- auto first-payment real_installment invoice creation
- auto recurring due invoice creation
- app-owned invoice email delivery
- PDF attachment or safe link
- override mailbox support
- cron readiness/gate/backlog/self-heal ops scripts

Do not implement new features unless a gap is found.
Start by checking readiness in the current environment, then tell me the exact next single step.
After each step, wait for me before continuing.

Use these rules:
- Mollie stays payment truth.
- e-Boekhouden stays invoice truth.
- no e-Boekhouden customer emails
- no invoice for mandate_only 0.01 first payments
- first-payment flow separate from recurring flow

Goal:
Get to a complete, working, autonomous invoicing system linked to payments, with live proof and clean backlog.
```

