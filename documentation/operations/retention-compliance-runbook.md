# Retention And Compliance Runbook

Status: active operations note
Audience: operators and engineers

## Purpose

This runbook tracks the current retention/compliance hardening work for compliance-sensitive data:

- audit logs
- webhook event history
- consent evidence
- metadata that may carry old or unnecessary personal data

Roadmap context: retention visibility and dry-run tooling are implemented. Any
future destructive apply path remains later backlog and must be promoted through
`../product/implementation-roadmap.md`; it is not active Mollie Connect work.

For shared-app tenant scope and release boundaries, also use
`../product/multi-tenant-pilot-scope.md`.

## Current Tooling

- `npm run ops:retention-report -- inventory <live|test|all>`
- `npm run ops:retention-report -- candidates <live|test>`

These commands are read-only. They report:

- current row counts
- policy-aligned candidate counts without row identifiers or stored payload values
- preserved evidence counts and the intended impact of any future redaction
- cleanup areas that remain blocked pending field/table allowlists

Current commands are not yet tenant-aware in product terms. Before a shared
multi-tenant pilot is considered ready, any operator-facing reporting surface
and any future destructive apply path must require explicit tenant scope in
addition to mode and data-area scope.

## Accepted Baseline Policy

The retention policy decision is no longer open and is no longer a blocker for implementation planning.

This is the accepted implementation baseline:

| Data area | Window | Action | Reason |
| --- | ---: | --- | --- |
| Audit logs | 7 years | keep operational/financial evidence; redact sensitive non-evidence `details` after 180 days where safe | Dutch business administration and invoice evidence commonly need a 7-year retention baseline; payload-like personal data should still be minimized |
| Accepted consent core evidence | subscription lifetime plus 7 years | keep consent terms snapshot, accepted checkbox set, acceptance timestamp, and plan snapshot | mandate, terms, and payment-authorisation evidence may be needed after the active subscription ends |
| Accepted consent IP/user-agent | 12 months | redact unless tied to dispute, fraud, security, or legal evidence | useful for short-term evidence and abuse investigation, but higher personal-data value than long-term proof of agreed terms |
| Processed webhook raw payloads | 180 days | delete or redact raw payload; keep minimal normalized event facts if useful | replay/debug value drops after reconciliation settles |
| Failed webhook raw payloads | 1 year after resolution | keep while unresolved; after resolution window delete or redact raw payload | failure payloads may be needed for incident review and repair |
| Test-mode operational data | 90 days | delete or anonymize if not linked to live evidence | test data has lower evidentiary value and should not accumulate personal data |
| Generic metadata | 180 days for non-evidence fragments | redact stale personal, token-like, payload-like fragments when safe | JSONB metadata must not become unmanaged personal-data storage |

## Legal Rationale

- GDPR/Dutch AVG does not set one universal retention period for all personal data. The app must keep personal data no longer than necessary, document the reason, and communicate retention clearly.
- Dutch business administration and invoice evidence generally uses a 7-year retention baseline; some immovable-property records can require longer, but this app's current core scope is subscription payment and invoice operations.
- Therefore, long retention is acceptable for financial, invoice, audit, mandate, and consent evidence, but not for raw payloads or high-detail personal-data fragments that are no longer needed.

Official references:

- [Business.gov.nl: GDPR compliance](https://business.gov.nl/running-your-business/legal-matters/how-to-make-your-business-gdpr-compliant/)
- [Belastingdienst: administration retention](https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/btw/administratie_bijhouden/administratie_bewaren/administratie_bewaren)
- [Belastingdienst: invoice retention](https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/btw/administratie_bijhouden/facturen_maken/uw_facturen_bewaren)
- [Business.gov.nl: preventing and reporting a data breach](https://business.gov.nl/running-your-business/security-and-fraud/data-breach/)

## Storage Cost Check

Current read-only check on 2026-06-18:

| Table | Rows | Size |
| --- | ---: | ---: |
| `audit_logs` | 136 | 168 kB |
| `subscription_onboarding_consents` | 6 | 128 kB |
| `webhook_events` | 12 | 48 kB |

Current storage for these specific tables is negligible. Cost risk is not the retention window itself; cost risk would come from storing large raw payloads, repeated full API snapshots, or binary/blob-like content in JSONB. Cleanup implementation should cap, redact, or remove raw payloads according to the accepted baseline above.

## Implementation Requirements

The policy decision is made, so policy UI and dry-run cleanup work can proceed.

Implementation must still follow these safeguards:

- keep `npm run ops:retention-report` read-only
- add cleanup as dry-run first
- require explicit tenant, mode, table/data-area, and window selection for any future destructive apply
- preserve invoice, payment, mandate, consent core evidence, and audit evidence unless the accepted policy explicitly permits removal/redaction
- separate raw payload redaction from row deletion where normalized evidence should remain
- log cleanup actions without storing the cleaned payload content again

## Safe Default

No automatic destructive cleanup. Use explicit dry-run, review, then scoped apply.

The settings page displays the accepted policy from the same typed source used by the report. Candidate reporting currently requires an explicit `live` or `test` mode, runs in a read-only transaction, and proposes zero mutations. For the shared multi-tenant pilot, operator-facing reporting and any future apply path must also require explicit tenant scope. Audit details remain review-only; generic metadata and broad test-data cleanup remain blocked until explicit allowlists exist.
