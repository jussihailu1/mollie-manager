# Documentation

This folder contains the active documentation for the project plus an archive of superseded notes.

Kify's purpose is easy automatic incasso. Invoicing and bookkeeping integrations
support that workflow; the roadmap defines the product boundary and priorities.
Start with the roadmap, then the receipt release record and its runbook.
Private workspace handoffs and financial evidence are retained outside public history.

## Required Reading Order

For product development, read active docs in this order:

1. `product/implementation-roadmap.md`: sole authority for active goal, milestone, and feature order
2. active implementation contract linked by the roadmap; currently
   `product/kify-owned-invoicing-implementation-plan.md`
3. relevant policy: `product/subscription-policy.md` and/or `product/recurring-billing-policy.md`
4. `product/feature-inventory.md`: current capability evidence only
5. `product/multi-tenant-pilot-scope.md`: tenant-isolation baseline when the work touches tenant business data or providers

Other active references:

- `architecture/overview.md`: current implementation shape and code map
- `development/setup.md`: local setup and environment guidance
- `development/commands-and-checks.md`: common developer and ops commands
- `development/codebase-review.md`: historical 2026-06-17 engineering assessment; never a sequencing authority
- `operations/invoice-automation-runbook.md`: invoice automation operations runbook
- `integrations/mollie.md`: Mollie integration boundaries and mode rules
- `integrations/mollie-account-ownership.md`: accepted platform/merchant ownership, OAuth versus API keys, and JHS relationship boundaries
- `operations/connect-and-bookkeeping-review-2026-11-07.md`: dated investigation evidence; its old correction queue is superseded by the current roadmap and completed repair reports
- `operations/eboekhouden-sales-posting-preview-2026-11-08.md`: local posting correction, read-only historical proposals and held date discrepancies
- `operations/eboekhouden-receipt-automation.md`: future receipt workflow, durable recovery, separate migration 0031 and disabled-by-default activation steps
- `integrations/eboekhouden.md`: e-Boekhouden integration boundaries and invoice rules
- `integrations/peppol.md`: Peppol strategy, monetization paths, and future integration direction

## Archive

- `archive/`: handoff notes, implementation plans, and superseded context kept for history only
- Dated release and repair reports under `operations/` remain evidence for the
  active rollout; their snapshots are not current runtime configuration.
- Keep the Kify implementation plan active until K7 proof and K8 retirement pass.
- Private financial evidence and operator executors remain outside public release
  history. Review the full outgoing history and staged diff before every public push.

## Rules

- Product rules live under `product/`.
- Feature sequencing lives in `product/implementation-roadmap.md`.
- `product/feature-inventory.md` never creates priority by itself.
- Operational procedures live under `operations/`.
- Technical structure lives under `architecture/`, `development/`, and `integrations/`.
- Archived docs are not authoritative.
- If active docs disagree on sequence, `product/implementation-roadmap.md` wins.
- Active docs always win over anything in `archive/`.
