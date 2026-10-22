# Security release — 22 October 2026

Status: user authorized commit/push to trigger the production Git deployment.
Deployment and post-release verification are pending at this checkpoint.

## Scope and preflight

- Release the validated source through `57b7bc2` plus this documentation checkpoint.
  Dependency and UI/test commits remain separate. Latest full validation:
  528/528 tests, lint, typecheck and production build pass; production audit zero.
  Nine development-only high audit entries from unpatched braces remain tracked.
- Fetched origin: master is ten commits ahead, zero behind, with a clean checkout.
  Remote is `https://github.com/jussihailu1/mollie-manager.git`.
- Verified Vercel project `mollie-manager` / `prj_DO7AjYeMLNuQ6BW8WtgWvsGxNdbv`,
  team `team_Bv4Mnsq4nacXWEj1H5efabqO`, production domain `kify.app`.
  Domain currently serves READY Git deployment `dpl_k3MdFPW76Uq2Xp14Jo2eqedr78AS`
  from repository `jussihailu1/mollie-manager`, branch master, commit `1179c82`.
- Vercel config uses Node 24.x; recorded isolated validation used Node 22.18.0.
  The actual Vercel build and post-deploy probes must pass on the hosted runtime.
- No migration application is needed. Build script does not apply migrations.
  Keep existing environment, invoice-recipient override and cron schedule intact.
- Authorization supersedes prior no-push/no-deployment restrictions for this
  reviewed release. It does not authorize billing, invoices, webhook replay,
  external email, provider/account mutations or unrelated worktree changes.

## Verification after push

Confirm remote SHA, deployment READY state, production alias and exact commit.
Run read-only health and authentication/access probes; no billing endpoint calls.
Record results and limitations. Genuine webhook processing, real OAuth round-trip,
external SMTP/inbox delivery and independent monitoring remain separate checks.

References: [snapshot validation](migration-snapshot-repair-2026-10-22.md),
[dependency review](dev-dependency-review-2026-10-22.md),
[UI/security validation](security-dependency-fixes-2026-10-22.md).
