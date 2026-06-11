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

## Current Blockers

The following work stays blocked on policy confirmation:

- purge script design
- dry-run cleanup thresholds
- deletion safeguards
- anonymization rules for consent evidence

## Safe Default

Do not add destructive cleanup defaults until the policy questions above are answered and documented.
