# Feature Inventory

This document tracks the current state after the Magic Patterns UI transplant.

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
- [ ] Reconciliation and test-alert controls are no longer exposed in the active UI.

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
- The next implementation pass should target the unchecked items in the first section, starting with whichever missing UI surface matters most.
