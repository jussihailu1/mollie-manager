# Retention And Compliance Runbook

Status: active operations note
Audience: operators and engineers

## Purpose

This runbook tracks the current retention/compliance hardening work for compliance-sensitive data:

- audit logs
- webhook event history
- consent evidence
- metadata that may carry old or unnecessary personal data

## Current Tooling

- `npm run ops:retention-report -- [mode] [auditDays] [webhookDays] [consentDays]`

This command is read-only. It reports:

- current row counts
- rows older than the chosen threshold
- oldest and newest timestamps
- consent-token storage state
- webhook retry pressure

## Open Policy Decisions

These decisions are still required before any destructive cleanup can be implemented safely:

1. Audit log retention window
2. Webhook event retention window
3. Consent evidence retention window
4. Whether accepted IP and user-agent fields should be kept, redacted, or dropped after a threshold
5. Whether live and test data should use the same retention windows or separate ones
6. Whether failed webhook payloads need a longer retention period than processed events

## Draft Baseline Policy

This is the starting proposal, not approved purge behavior:

| Data area | Draft window | Draft action | Reason |
| --- | ---: | --- | --- |
| Audit logs | 7 years | keep, then review export/delete | financial and operational evidence can matter for tax, billing, and incident investigation |
| Accepted consent evidence | subscription lifetime plus 7 years | keep consent terms snapshot; review IP/user-agent minimization after 12 months | mandate/terms evidence must outlive active billing disputes |
| Processed webhook events | 180 days | delete payload and row after window | operational replay value drops after reconciliation history settles |
| Failed webhook events | 1 year after resolution | keep longer than processed rows; delete after resolution window | failure payloads help incident review and repair |
| Test-mode operational rows | 90 days | delete/anonymize if not linked to live evidence | test data has lower evidentiary value |
| Generic metadata | 180 days for non-evidence payload fragments | redact stale personal/token-like fragments when safe | JSONB metadata should not become unmanaged personal-data storage |

## Decision Pass Started

Next step is to confirm or change the draft baseline above with the business/legal owner. Until then:

- keep `npm run ops:retention-report` read-only
- do not add default purge behavior
- design future cleanup as dry-run first, scoped by mode and table
- preserve invoice, payment, mandate, consent, and audit evidence unless policy explicitly allows removal

## Current Blockers

The following work stays blocked on policy confirmation:

- purge script design
- dry-run cleanup thresholds
- deletion safeguards
- anonymization rules for consent evidence

## Safe Default

Do not add destructive cleanup defaults until the policy questions above are answered and documented.
