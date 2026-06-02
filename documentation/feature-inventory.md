# Feature Inventory

This document tracks the current state after the Magic Patterns UI transplant.

Policy source docs for the next subscription feature pass:

- Current-state policy: `documentation/subscription-policy.md`
- Current-state recurring billing policy: `documentation/recurring-billing-policy.md`
- Future-state roadmap: `documentation/subscription-roadmap.md`

## Remaining After MP Transplant

These items are still in the backend or planned scope, but they are not fully represented in the active UI right now.

- [ ] Dedicated subscription management page is gone from the active UI.
- [ ] Dedicated standalone payment-links management page is gone from the active UI.
- [ ] Dedicated settings/configuration page is gone from the active UI.
- [ ] Subscription stop / cancel controls still exist in backend actions, but they are not surfaced in the new UI.
- [ ] Manual webhook replay is still supported in backend actions, but it is not surfaced in the new UI.
- [ ] Detailed subscription table/history view is no longer a first-class screen.
- [ ] Detailed customer history tables for payments, mandates, and subscriptions are no longer a first-class screen.
- [ ] Platform readiness / integration diagnostics are no longer a dedicated screen.
- [ ] Test-alert control is no longer exposed in the active UI.
- [x] Manual reconciliation control is exposed again from `/settings`, scoped to the currently selected Mollie mode.
- [x] Fixed-term subscription support is implemented with `subscription_term_mode`, `total_payments`, derived `last_charge_date`, `service_end_at`, and `cancellation_effect`.
- [x] The recurring onboarding flow now uses an app-hosted consent screen before Mollie checkout.
- [x] The recurring onboarding flow now discloses cancellation-by-email terms to the customer.
- [x] Tenant-default subscription policy modeling is implemented for v1 with DB defaults bootstrapped from env.
- [x] Onboarding supports first-payment mode selection (`real_installment` default or `mandate_only` at `EUR 0.01`) with consent-bound subscription creation.
- [x] Consent snapshots now include recurring billing notice terms: invoice email before automatic collection, 5 calendar day pre-notification, SEPA failure/reversal disclosure, and mandate-only exclusion.
- [x] Recurring payment sync stores operational collection state and opens policy-aware alerts for confirmed failures, mandate problems, and reversals without treating pending SEPA payments as failed.
- [x] Recurring billing schedule rows are stored per subscription and planned collection date, with invoice send due date calculated 5 calendar days before collection.
- [x] Tenant billing settings now store e-Boekhouden invoice template, revenue ledger, 21% VAT code, plain-text line source, and app-owned email delivery mode separately from policy.
- [x] Settings discovery fetches e-Boekhouden invoice templates and ledger accounts from the official REST API and shows them as dropdowns, so template and ledger IDs do not need to be typed manually.
- [x] e-Boekhouden recurring invoice creation service exists for scheduled billing rows once tenant billing settings are complete.
- [x] Operators can now manually create due recurring e-Boekhouden invoices from `/settings`, gated on complete billing settings and the selected Mollie mode.
- [x] Due recurring invoice creation now claims schedule rows before the upstream API call, stores returned e-Boekhouden invoice id/number on success, and writes audit logs plus operator alerts for success/failure.
- [x] App-owned invoice email delivery is implemented for first-payment and recurring invoices, with SMTP override support via `INVOICE_EMAIL_OVERRIDE_TO` and recipient audit metadata.
- [ ] Reconciliation pass needs explicit invoice-automation-safe mode (sync/normalize only, no unintended create/send side effects unless explicitly requested).
- [ ] Reconciliation run output should include first-payment + recurring invoice-state deltas (`pending_invoice`, `invoice_failed`, `invoice_created`, `invoice_sent`) for operator review.
- [ ] Reconciliation should expose explicit “invoice sync mode” controls in UI/ops (`sync-only` vs `sync+invoice-actions`) to avoid accidental duplicate-side-effect risk.
- [ ] Reconciliation observability still needs tighter integration with invoice automation heartbeat/gate output (single operator view for stale sync + stale cron).
- [ ] Reconciliation docs/runbook mapping should be finalized so operators know when to use reconciliation vs cron invoice automation vs safe requeue.

## Retained In Current UI

These features are still present in the app after the transplant.

- [x] Global app shell with dashboard, customers, payments, and notifications navigation.
- [x] Active dashboard, customers, payments, notifications, and shell surfaces now render real app data instead of placeholder/demo records.
- [x] Notification bell with unread count and recent alert list backed by stored alert data.
- [x] Test/live mode switching is available from the shell menu and updates the real selected Mollie mode cookie.
- [x] Test/live mode now consistently scopes dashboard data, customer detail data, operational alerts, audit activity, reconciliation, webhook replay, alert status actions, and Mollie create/sync actions to the currently selected Mollie mode.
- [x] The shell mode selector uses a normal shadcn switch with corrected switch thumb sizing.
- [x] Dashboard summary cards for customer count, pending first payments, active subscriptions, and paid payment revenue.
- [x] Dashboard recent activity driven by real audit logs.
- [x] Customer list with search, status filtering, sorting, and quick actions.
- [x] Customer drawer with contact details, workflow timeline, payment-link visibility, and contextual next action.
- [x] Customer creation with business name, contact name, invoice email, address, phone, and notes.
- [x] Customer data persistence for business/contact/address/phone using `customers.metadata`.
- [x] Real Mollie customer creation on customer submit.
- [x] e-Boekhouden REST API v1 relation import flow in the Add Customer dialog.
- [x] e-Boekhouden relation picker fetches available relations, excludes already-linked relations in the selected mode, and opens the e-Boekhouden web app for creating a relation upstream.
- [x] Selecting an e-Boekhouden relation fetches full relation details and pre-fills the local customer form.
- [x] Imported e-Boekhouden customers create a local bridge record and Mollie customer while storing `eboekhouden_relation_id`, relation code, link status, sync timestamp, and a relation snapshot.
- [x] Local-only customer creation is still allowed and shows an unlinked e-Boekhouden warning/status.
- [x] Existing local customers can be linked to an e-Boekhouden relation from the customer table or drawer.
- [x] e-Boekhouden link flow detects local-vs-e-Boekhouden field conflicts, defaults to the e-Boekhouden value, and lets the user choose the local value before linking.
- [x] Chosen local values for e-Boekhouden-owned fields are patched back to e-Boekhouden before the local link is saved.
- [x] Real first-payment link creation from the new UI.
- [x] Real Mollie sync / refresh action in place of the old simulated payment step.
- [x] Real subscription creation from the new UI, still guarded by paid first payment and ready mandate checks.
- [x] Payments screen with stats, filtering, sorting, date filtering, pagination, and CSV export.
- [x] Payments screen action to create a new first-payment link.
- [x] Notifications screen with attention cards from operational-alert queries plus unread/read filtering, type filtering, and pagination for stored alerts.
- [x] Mark individual alerts read/unread.
- [x] Dismiss alerts by resolving them.
- [x] Mark all alerts as read.
- [x] Open alert targets directly into the active UI surfaces.
- [x] Legacy `/customers/[customerId]` route now forwards into the customer workspace drawer.
- [x] Legacy `/alerts`, `/payment-links`, and `/settings` routes now forward into the new active surfaces instead of staying live as separate UI modules.
- [x] The former subscriptions dashboard screen has been removed; subscription details now live in customer views and sheets.
- [x] Client-rendered dates use deterministic app formatters to avoid server/client hydration mismatches.

## Backend And Domain Still Intact

These are still part of the product behavior even if the new UI is narrower than the previous one.

- [x] NextAuth login flow.
- [x] Mollie customer, payment-link, payment, mandate, and subscription domain model.
- [x] e-Boekhouden REST API v1 session-token authentication using `EBOEKHOUDEN_API_TOKEN` and optional `EBOEKHOUDEN_API_SOURCE`.
- [x] e-Boekhouden relation list/detail/update integration with server-only API token handling.
- [x] Webhook processing and local webhook event storage.
- [x] Alert storage and email delivery.
- [x] Audit log writing.
- [x] Reconciliation and sync logic.
- [x] Subscription cancellation backend actions.
- [x] Manual webhook replay backend action.

## Notes

- The new UI uses the latest Magic Patterns structure as the active product surface.
- The active dashboard, customers, payments, notifications, and shell surfaces are wired back to real data and server actions.
- The richer customer fields are still stored in `customers.metadata`; e-Boekhouden link state now has first-class customer columns and a Drizzle migration in `db/drizzle`.
- e-Boekhouden import/linking requires `EBOEKHOUDEN_API_TOKEN` in the server environment. `EBOEKHOUDEN_API_SOURCE` defaults to `Kify`.
- e-Boekhouden billing settings are accounting configuration, not subscription policy. The revenue ledger label is only an internal fallback/display label; the selected e-Boekhouden ledger ID is the actual accounting mapping.
- The next subscription feature pass should follow `documentation/subscription-policy.md` and `documentation/recurring-billing-policy.md`.
- Longer-term subscription-platform work should accumulate in `documentation/subscription-roadmap.md`.
- Reliability follow-up to keep on the future backlog: add scheduled reconciliation as a backend safety net even when webhooks are working, so missed or delayed webhook delivery does not leave local state stale.
- Manual recurring invoice creation intentionally stops on `invoice_failed` rows after uncertain upstream outcomes so operators can review before any retry and avoid duplicate e-Boekhouden invoices.
