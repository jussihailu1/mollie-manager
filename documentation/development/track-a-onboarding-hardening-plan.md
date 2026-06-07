# Track A: Onboarding Hardening Plan

Status: active implementation plan, consent-token redesign implemented
Audience: engineering and product
Related docs:

- `codebase-review.md`
- `../product/feature-inventory.md`

## Purpose

This plan turns Track A from the codebase review into an implementation-ready sequence.

Primary goal:

- remove consent-token leakage and tighten onboarding data handling

Secondary goal:

- improve the operator share-link workflow at the same time so the hardening work also delivers product value

## Current Status

Implemented in the first pass:

- redirect notices now stay generic
- consent tokens are no longer written into audit details
- `payment_links.metadata` no longer duplicates the active consent token
- latest consent links are now resolved through a narrower authenticated endpoint instead of broad customer overview payloads
- the customer drawer return flow now preserves focus and gives operators a copyable hosted-link path
- helper and test coverage were added for the consent-link URL, notice behavior, and narrowed consent scope
- canonical consent lookup now uses `consent_token_hash`
- operator link regeneration now uses encrypted token recovery instead of plaintext canonical storage
- a one-time backfill script is available to erase legacy plaintext consent tokens after the schema migration

Still open:

- keep the remaining hardening tracks sequenced after this pass

## Why Start Here

This is the best first hardening track because it solves a real security issue and also improves an active operator workflow.

Current implementation already has a customer-drawer copy surface for the hosted consent link:

- customer drawer UI in [components/customer-flow-dialogs.tsx](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/components/customer-flow-dialogs.tsx:1713>)
- URL derivation in [lib/ui-data.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/ui-data.ts:125>)
- latest consent token selection in [lib/onboarding/data.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/onboarding/data.ts:249>)

That means the first pass does not need a brand-new share system. It can harden the current flow and then make that existing surface the primary operator path.

## Scope

In scope:

- consent-token exposure in notices, audit logs, and non-essential metadata
- operator UX for sharing or copying the hosted consent link
- minimal data-flow cleanup around hosted consent token usage
- tests covering the hardened flow

Out of scope for this track:

- invoice PDF fetch hardening
- `/api/health` redesign
- webhook secret redesign
- full hash-based token redesign unless the simple containment pass reveals it is worth doing immediately

## Current Problem Map

### Token creation and storage

- token generation: [lib/onboarding/actions.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/onboarding/actions.ts:1124>)
- token persisted in dedicated consent table: [lib/onboarding/actions.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/onboarding/actions.ts:1219>)
- token no longer duplicated in `payment_links.metadata` after pass 1

### Token exposure to operators and logs

- token no longer written into audit details after pass 1
- audit write path: [lib/audit.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/audit.ts:45>)
- token no longer exposed in redirect notice query string after pass 1
- notices are displayed in customers workspace: [components/customers-workspace.tsx](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/components/customers-workspace.tsx:314>)

### Token consumption and UI reuse

- token used by hosted consent page: [app/subscribe/[token]/page.tsx](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/app/subscribe/[token]/page.tsx:45>)
- token used by hosted return page: [app/subscribe/[token]/return/page.tsx](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/app/subscribe/[token]/return/page.tsx:42>)
- operator-facing latest token selection: [lib/onboarding/data.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/onboarding/data.ts:249>)
- operator-facing absolute URL derivation: [lib/ui-data.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/ui-data.ts:125>)
- operator-facing drawer copy flow: [components/customer-flow-dialogs.tsx](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/components/customer-flow-dialogs.tsx:964>)

## Implementation Strategy

Do this in three passes.

### Pass 1: Contain the leak without changing the product flow

Objective:

- keep onboarding behavior intact
- stop the obvious leakage paths immediately

Changes:

1. Stop putting the full hosted consent link into redirect notices.
2. Keep the success notice generic, for example:
   - `First payment consent link created. Open the customer to copy the hosted link.`
3. Stop writing `consentToken` into audit log details.
4. Stop writing `consentToken` into `payment_links.metadata` unless a concrete runtime dependency proves it is required.
5. Keep `subscription_onboarding_consents.consent_token` as the canonical lookup source for now.

Status:

- completed
- the canonical token remains in the dedicated consent table
- the operator copy/open flow now uses the customer drawer instead of a token-bearing notice

Primary files:

- [lib/onboarding/actions.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/onboarding/actions.ts>)
- [lib/audit.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/audit.ts>)
- [components/customers-workspace.tsx](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/components/customers-workspace.tsx>)

Acceptance criteria:

- creating a consent link no longer places the token or URL in query params
- audit rows for consent-link creation no longer include the active token
- payment-link metadata no longer stores the active token unless justified and documented
- operator can still retrieve the current hosted consent link from the existing UI

### Pass 2: Make the operator share flow explicit and first-class

Objective:

- replace the old “success notice contains the link” behavior with an intentional workflow

Changes:

1. Promote the hosted consent link section in the customer drawer so it is clearly actionable.
2. Consider adding one or both:
   - a `Copy hosted consent link` primary action when consent exists
   - an `Open hosted consent page` external-link action
3. When a consent link is created, keep focus on the customer and direct the operator to the drawer flow instead of returning a secret-bearing message.
4. Make sure the UX still works after page refresh because the link is derived from stored customer/consent state rather than transient flash data.

Primary files:

- [components/customer-flow-dialogs.tsx](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/components/customer-flow-dialogs.tsx>)
- [components/customers-workspace.tsx](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/components/customers-workspace.tsx>)
- [lib/ui-data.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/ui-data.ts>)
- [lib/onboarding/data.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/onboarding/data.ts>)

Acceptance criteria:

- operator can always find and copy the latest hosted consent link from the customer flow
- no security-sensitive value is needed in flash messages to complete the operator workflow
- the drawer and table behavior still feels fast and obvious

### Pass 3: Tighten token ownership and add test coverage

Objective:

- make the token model clearer and safer for future work

Changes:

1. Keep the hashed lookup model and encrypted operator recovery path in place.
2. Add tests around:
   - consent-link creation result shape
   - audit detail redaction
   - no-token-in-notice behavior
   - customer UI URL derivation from hashed/encrypted consent storage via the authenticated consent-link endpoint
3. Run the one-time plaintext backfill script after the schema migration during rollout.

Status:

- implemented
- the remaining rollout step is running `npm run db:backfill-consent-tokens` after the schema migration

Primary files:

- [lib/onboarding/data.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/onboarding/data.ts>)
- [lib/ui-data.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/ui-data.ts>)
- [lib/subscription-consent.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/subscription-consent.ts>)
- new tests under `lib/**/*.test.ts`

Acceptance criteria:

- the token has one clearly documented canonical storage path
- the operator workflow is covered by executable tests at the right seams
- canonical consent lookup no longer depends on plaintext token storage
- operator link regeneration still works without reintroducing plaintext as the canonical DB field

## Suggested Task Breakdown

### Task 1: Remove query-string sharing of hosted consent links

Files:

- [lib/onboarding/actions.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/onboarding/actions.ts>)
- [components/customers-workspace.tsx](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/components/customers-workspace.tsx>)

Notes:

- this is the highest-signal immediate fix
- it should be small and low-risk

### Task 2: Redact consent token from audit details

Files:

- [lib/onboarding/actions.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/onboarding/actions.ts>)
- [lib/audit.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/audit.ts>)

Notes:

- likely only the onboarding action needs changing
- no generic audit framework work should be required unless more secret-bearing audit details are discovered

### Task 3: Remove token duplication from `payment_links.metadata`

Files:

- [lib/onboarding/actions.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/onboarding/actions.ts>)
- [lib/reliability/sync.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/reliability/sync.ts>) only if a read dependency is found
- [lib/onboarding/data.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/onboarding/data.ts>) only if a query depends on metadata instead of consent rows

Notes:

- verify reads before removing the field
- default assumption: dedicated consent table should own the token, not payment-link metadata

### Task 4: Make the drawer share flow the intentional operator path

Files:

- [components/customer-flow-dialogs.tsx](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/components/customer-flow-dialogs.tsx>)
- [components/customers-workspace.tsx](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/components/customers-workspace.tsx>)
- [lib/ui-data.ts](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/lib/ui-data.ts>)

Notes:

- this is the “second bird”
- it turns a security fix into a clearer onboarding workflow

### Task 5: Add focused tests

Files:

- new tests near onboarding and consent modules
- [package.json](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/package.json>) only if new test entry structure is needed

Notes:

- keep tests narrow and flow-focused
- do not wait for a full refactor before adding them

## Recommended Execution Order

Do the work in this exact order:

1. Task 1: remove query-string sharing
2. Task 2: redact token from audit details
3. Task 3: remove token duplication from metadata
4. Task 4: improve operator copy/open flow in the drawer
5. Task 5: add tests that lock the new behavior

Reasoning:

- the first three tasks reduce real exposure immediately
- task 4 preserves and improves usability after the old shortcut is removed
- task 5 locks in the hardened flow before moving to the next track

## Feature Overlap

This track directly supports existing planned work in [feature-inventory.md](<C:/Root/Work/J Hailu Solutions/Ayal Web/Mollie Manager/mollie-manager/documentation/product/feature-inventory.md>):

- safer, clearer operator controls
- improved customer workflow ergonomics
- future reconciliation and repair surfaces that should avoid secret-bearing flash state

This is why Track A should be done before broader ops-surface or reconciliation UX work.

## Deliverable Definition

Track A is considered complete when all of the following are true:

- no hosted consent token is exposed through redirect notices
- no active hosted consent token is written into audit log details
- token ownership is reduced to the minimum required storage path
- operator can clearly copy or open the hosted consent link from the customer workflow
- the new behavior is covered by tests

## Follow-On Decision

Track A follow-on status:

1. Track C: ops surface hardening completed
2. Invoice delivery hardening completed

Current recommended follow-on is the next operator-facing reliability slice:

1. reconciliation output delta follow-up completed in `/settings`
2. continue with deeper modularization and test refactor work from Track D
