# Security release — 22 October 2026

Status: RELEASED. User-authorized push deployed `e1f895c861f95b374293c44d6b908a5d8997dbc8`
to production; deployment and read-only post-release checks passed.

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

## Result — 22 October, 23:37 Europe/Amsterdam

- Pushed master from `1179c82` to `e1f895c`; independently verified the remote SHA.
  Release checkpoint `e1f895c` contains documentation only above validated
  application source `57b7bc2`.
- Vercel production deployment `dpl_DukhWo1YHo2DZhhyQzwPabi5L6xa` is READY.
  Domain lookup confirms `kify.app` and `www.kify.app` assigned to that deployment,
  exact Git SHA and master branch, with no alias error. Hosted build reports
  Next.js 16.4.2 / Turbopack; build-to-ready duration about 54 seconds.
- Ten GET-only production checks passed: login render, sole Google OIDC provider,
  CSRF response, anonymous session, three protected page/API/document redirects,
  minimal public health, authenticated unscoped health and webhook GET 405.
  Authenticated health reports database OK, platform readiness passed, live mode.
  Health request ID: `fra1::iad1::kh844-1792705021155-25cbcaf872a3`.
- Initial probe stopped after eight successful public/access checks because the
  saved production environment file lacked a health credential. Reused the
  existing local legacy cron credential in memory for the same Kify health route;
  the server authenticated it and all ten checks passed. No credential was
  printed, persisted in evidence, or changed. This confirms the legacy secret
  is still accepted, not that external callers no longer need it.
- Deployment-scoped runtime error/fatal log query returned no records in the
  initial observation window. This is a limited observation, not proof of no errors.
- No migration, billing/repair endpoint, invoice, webhook POST/replay, external
  email or provider/account mutation was invoked. Real OAuth round-trip,
  genuine webhook handling, external inbox delivery and independent monitoring
  remain open. Nine development-only braces findings remain tracked.
- Safe probe results and script are outside Git at
  `C:\Users\Jussi\Kify-Recovery\2026-10-22-security-release`.
  This post-release evidence is a separate local documentation checkpoint;
  it is not pushed solely to trigger another identical application deployment.
