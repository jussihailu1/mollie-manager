# Automatic Receipt Release — 12 November 2026

Status: release checks passed; migration, activation and genuine-payment proof pending

## Scope

Release future-only gross receipts for the existing tenant through the protected
daily cron. The writer supports full EUR payments against e-Boekhouden-issued
invoices, at most five candidates per tenant per run. Kify-issued invoice export,
fees/payouts, refunds, partial payments and historical repairs remain outside scope.

## Release Isolation

Production and remote master were verified at `b64f3e7`. A clean release branch
starts there and imports reviewed implementation files without the private local
history. Private financial reports and executors are excluded. The source worktree
and the shared workspace's 68 changed paths remain preserved; a private SHA-256
manifest records their starting bytes. Optional bookkeeping-consent changes and
old migration 0030 are excluded. Migration 0031 upgrades directly from 0029.

## Verification And Rollout Gates

- Fresh production health passes; receipt tables and bookkeeping-consent column
  are absent before migration.
- The selected administration has no closed accounting periods on the release day.
- Clean install, all 796 Node tests, full lint, TypeScript and production build
  passed on the clean release. The build used a dummy authentication secret.
- The raw-SQL guard now recognizes the reviewed ephemeral database tests, read-only
  preview, explicit temporary-table checks and exact existing advisory-lock SQL.
  The guard passed; a negative probe still rejected unauthorized raw business SQL.
- Public documentation excludes new private repair reports. Current copies of four
  previously published summaries are sanitized; their older public history is not
  rewritten by this release.
- Migration, tenant account/profile preview, future cutoff, configuration, deployment
  and activation remain separate steps, recorded here after they pass.
- Never manufacture invoices/payments, replay historical repairs, resend old
  documents or change their original dates to obtain proof.

## Open Live Proof

The first naturally due combined invoice/sales posting and automatic receipt must
still demonstrate one matching entry each, original dates, gross clearing movement,
settled outstanding amount, unchanged revenue, delivery and safe reconciliation.
Local checks and successful deployment do not close that gate.

Tenant readiness is next under the [roadmap](../product/implementation-roadmap.md).
Independent-tenant incasso and K7/M6 proof require completed setup and genuine flows.
K8 remains pending. The 17 November SDK-review checkpoint is retained.

Raw release evidence is private and excluded from Git. Use the
[receipt runbook](eboekhouden-receipt-automation.md) for configuration and stop steps.
