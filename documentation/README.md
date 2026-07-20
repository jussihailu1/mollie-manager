# Documentation

This folder contains the active documentation for the project plus an archive of superseded notes.

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
- `integrations/eboekhouden.md`: e-Boekhouden integration boundaries and invoice rules
- `integrations/peppol.md`: Peppol strategy, monetization paths, and future integration direction

## Archive

- `archive/`: handoff notes, implementation plans, and superseded context kept for history only

## Rules

- Product rules live under `product/`.
- Feature sequencing lives in `product/implementation-roadmap.md`.
- `product/feature-inventory.md` never creates priority by itself.
- Operational procedures live under `operations/`.
- Technical structure lives under `architecture/`, `development/`, and `integrations/`.
- Archived docs are not authoritative.
- If active docs disagree on sequence, `product/implementation-roadmap.md` wins.
- Active docs always win over anything in `archive/`.
