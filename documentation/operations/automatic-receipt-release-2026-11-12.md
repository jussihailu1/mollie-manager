# Automatic Receipt Release — 12 November 2026

Status: live for the existing tenant with a future cutoff; genuine-payment proof open

## Released Scope

The protected daily cron can post verified full gross EUR receipts against
e-Boekhouden-issued invoices, at most five candidates per tenant per run. The
existing tenant is enabled for payments from **13 November 2026, 00:00
Europe/Amsterdam** (12 November 23:00 UTC). Earlier payments remain excluded.
Kify-issued invoice export, fees/payouts, refunds, partial payments and historical
repairs remain outside this release.

## Isolation And Checks

- Production and remote master were verified at `b64f3e7` before release. The clean
  branch starts there; the private local receipt-history commits are not ancestors.
- New private financial reports and executors were excluded. Four already-published
  summaries were sanitized in the current tree; older public Git history remains.
- The source worktree and the shared workspace's 68 changed paths are preserved.
  A private SHA-256 manifest records those bytes. No shared reset, stash or blanket
  commit was used. Optional bookkeeping-consent work and migration 0030 are excluded.
- Clean install, **797 Node tests**, full lint, TypeScript, production build and the
  raw-SQL guard pass. Tests use synthetic providers/ephemeral PostgreSQL; the local
  build uses a dummy authentication secret.
- The actual configuration CLI exposed an eager request/session import in audit
  logging. System audit calls now load without request code; implicit user auditing
  still requires its session. A subprocess test covers the real CLI import path.
- Raw-SQL exceptions cover reviewed ephemeral tests, read-only preview, explicit
  temporary-table verification and exact existing advisory-lock statements. A
  negative probe confirms arbitrary raw business SQL remains rejected.

## Migration, Configuration And Deployment

- Only migration 0031 was pending. It applied directly after 0029; its recorded
  SQL hash matches the reviewed file. The new receipt tables were empty afterward,
  the consent column remained absent and existing financial-row hashes matched.
- A fresh browser review of the selected administration found no closed periods.
  Provider reads verified the tenant's existing financial account and Mollie
  organization/profile. Configuration preview and apply used the same future cutoff;
  one enabled live mapping and zero claims were read back.
- The production-only runtime flag is exactly `true`. No invoice-recipient override
  was configured. The next ordinary invoice date remains **26 November 2026**;
  current scheduled volume fits the five-candidate daily limit. Reassess capacity
  before promising that throughput to another tenant.
- Staged production `dpl_6L3CkcTyQdnuQDW1mZ4TDnCYBKYi` was built from
  `9d33af5`. All **688 uploaded source files** matched the reviewed checkout.
  Generated local types/build metadata were excluded. Build, protected login and
  authenticated health checks passed before promotion to [kify.app](https://kify.app).
  The final Git release adds documentation only to this verified runtime.
- No billing cron, payment, invoice, repair batch or customer email was invoked for
  proof. Configuration/migration created no financial entry or invoice-date change.

## Open Proof And Next Work

Observe the next normal scheduled run and genuine transaction. Confirm one matching
sale and receipt, original invoice date, Amsterdam payment date, fully settled
outstanding amount, gross clearing movement, unchanged revenue, customer delivery
and safe reconciliation. Deployment/health and historical repairs do not close this.

Tenant readiness is the next K7 implementation slice under the
[roadmap](../product/implementation-roadmap.md): complete setup checks, tenant policy
editing, suitable mail identity, explicit accounting support and receipt setup/capacity.
Independent-tenant consent/mandate/activation/collection, first-payment and recurring
invoice proof, webhook/recovery and isolation remain open under K7/M6. K8 remains
pending. The **17 November SDK-review checkpoint** is retained.

Raw evidence remains private outside Git. Use the
[receipt runbook](eboekhouden-receipt-automation.md) for configuration and stop steps.
