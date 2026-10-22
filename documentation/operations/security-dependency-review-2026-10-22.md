# Dependency-security review — 22 October 2026

Status: historical review; findings subsequently addressed in the
[local fixes and validation](security-dependency-fixes-2026-10-22.md).
The review below records the original **release-blocked** candidate.
No dependency/source changes, production operations, push or deployment.
This supersedes the current-readiness claims in the
[8 October evidence](security-dependency-update-2026-10-08.md), which remains
historical evidence for implementation commit `4cb19ed`.

## Scope and reproducibility

Reviewed pending implementation `4cb19ed` against its parent and the runtime diff
from production `1179c82`. Current reviewed source is
`909088f306e0fb3a1b099ee874db1dfc16a36154`; later commits since `4cb19ed` contain
documentation only. The runtime diff is package.json, package-lock.json, the
mailer import/types, and the new loopback SMTP tests. Billing/authentication
application logic was not changed by that commit.

Validation ran at 22:29–22:33 Europe/Amsterdam using Node 22.18.0 / npm 11.7.0
in a fresh `git archive` source copy with its own clean `npm ci` installation.
No application `.env` files were copied; child processes received an explicit
OS-environment allowlist plus synthetic auth configuration. No database, payment
provider or external SMTP credentials were supplied. SMTP integration was
confined to loopback. No OAuth sign-in/callback was initiated.

- Source copy:
  `C:\Users\Jussi\AppData\Local\Temp\kify-security-review-20261022-5ffd740fabcf4fee96331b9f80d41cb8`
- Logs, JSON audits, lint summary, command results and local HTTP probe:
  `C:\Users\Jussi\Kify-Recovery\2026-10-22-security-review`
- The copied lockfile is byte-identical to the checkout; package.json and mailer
  sources match after normalizing Windows checkout line endings. No lockfile or
  source edits were made by validation. The local HTTP server was stopped.

## Findings and required follow-up

### 1. Next.js 16.4.0 is no longer a safe release target

Fresh `npm audit --omit=dev --json` reports **one critical package entry**,
`next`, aggregating three advisories (two critical, one high). The zero finding
result from 8 October is obsolete. The advisories were published on 14 October:

- [GHSA-2464-fhr4-w9xw](https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw):
  image-optimization RCE on affected Linux configurations. This candidate already
  locks and installs `sharp@0.35.5`, satisfying the maintainer's stated workaround
  for this particular advisory. This does not clear the other Next.js findings.
- [GHSA-p3m5-59mp-jv5r](https://github.com/vercel/next.js/security/advisories/GHSA-p3m5-59mp-jv5r):
  denial of service in App Router applications with Server Actions. This app uses
  App Router and multiple Server Actions, so the documented prerequisite applies.
- [GHSA-673q-mjm6-r5xr](https://github.com/vercel/next.js/security/advisories/GHSA-673q-mjm6-r5xr):
  RCE involving Cache Components and `use cache` functions returning typed arrays.
  Source inspection found no `use cache` or enabled `cacheComponents`; exploitation
  of this condition was not established. The maintainer still recommends upgrading.

All three name 16.4.1 as patched. npm currently proposes **16.4.2**, and registry
reads verified that both `next@16.4.2` and `eslint-config-next@16.4.2` exist.
Update those pins together and regenerate the lockfile, then rerun validation.
No 16.4.2 implementation or runtime validation is claimed by this review.
Do not release the existing 16.4.0 candidate as the security fix.

### 2. Full lint remains red after the tooling update

Clean-source ESLint reports **10 errors and 11 warnings**. All errors are
`react-hooks/set-state-in-effect` with `eslint-plugin-react-hooks@7.1.1`:

| Source | Error lines in reviewed source |
| --- | --- |
| `components/customer-flow-dialogs.tsx` | 1373, 1386, 1430, 2084, 2137, 2198, 2259 |
| `components/payment-drawer.tsx` | 276, 352, 405 |

The affected component files are unchanged from production and the security
commit's parent. These are new diagnostics on existing effect/state patterns,
not proof that the dependency update introduced a runtime regression. They still
prevent a clean lint result. Refactor loading/reset/action-result handling in a
bounded UI change while preserving request cancellation, customer/payment switch
behavior and repair throttling. Do not disable rules or introduce timer tricks
solely to hide diagnostics. Review the existing missing
`hasBillingHistoryToLoad` dependency warning during that work.

The clean source excludes the unrelated ignored `.artifacts` fixture mentioned
in the old mixed-checkout lint result. Warnings include unused imports/props,
the dependency warning and internal `window.location.assign` navigation.

### 3. One pre-existing lifecycle UI assertion still fails

Full Node suite: **510/511 pass**. The sole failure is
`lib/customer-lifecycle-ui-scope.test.ts:15`, expecting `lifecycle.summary` in
`components/customer-flow-dialogs.tsx`. The following `lifecycle.reason` assertion
would also need review: the component currently uses lifecycle state for badges
but does not render those two fields. The component and test match production and
the security commit's parent; this is the previously recorded baseline mismatch.

Resolve whether the UI must expose the summary/reason, then align its behavior
and test with that contract. Do not silently remove the assertion merely to mark
the dependency update green. No lifecycle UI change was made in this review.

### 4. One new development-only issue has a compatible patch

Full audit: **15 package entries: 1 critical, 9 high, 5 moderate**. Of these,
14 are development-only (9 high, 5 moderate). These are package entries including
transitive propagation, not 15 independent vulnerabilities or proof of exploitation.

- New since the old report: `ip-address@10.7.3`, moderate
  [GHSA-rxp7-6hxx-x8q5](https://github.com/advisories/GHSA-rxp7-6hxx-x8q5).
  Registry verification found patched `10.7.4`. Both recorded parents
  (`express-rate-limit` and `socks`) are dev dependencies and allow this patch
  through their existing `^10.x` ranges. Refresh this transitive resolution and
  re-audit; do not add an unnecessary runtime dependency.
- Existing braces/fast-glob/micromatch tooling chain remains high. Registry latest
  is still braces 3.0.3; the current audit identifies no patched braces release.
- Existing drizzle-kit loader chain retains nested esbuild 0.18.20. Registry
  latest stable drizzle-kit is still 0.31.11 and still depends on the deprecated
  `@esbuild-kit/esm-loader` chain. The separately installed newer esbuild does not
  replace that nested version.
- Reject npm's suggested forced downgrades of Next ESLint config, shadcn and
  drizzle-kit. Track the residual development chains separately; do not expose
  their development servers or process untrusted tooling input. A zero full-audit
  result is not currently established through supported compatible updates.

## Refreshed validation

| Check | Result |
| --- | --- |
| Clean `npm ci --no-audit --no-fund` | PASS; 744 packages, no peer-resolution failure |
| Production audit | FAIL; one critical Next.js package entry, three advisories |
| Full audit | FAIL; 15 entries (1 critical / 9 high / 5 moderate) |
| Full Node suite | 510 pass / 1 pre-existing failure |
| Loopback SMTP integration, within full suite | 2/2 PASS; auth, intended recipient, text/HTML, PDF bytes, rejection/no retry |
| Existing auth, cron notification and alert-delivery tests | PASS within full suite |
| Full ESLint | FAIL; 10 errors / 11 warnings |
| Typecheck | PASS |
| Default production build (Turbopack) | PASS |
| Installed dependency-tree check | PASS; one mailer, Nodemailer 10.0.16 under `nodemailer-smtp`; no legacy `nodemailer` installed |
| Local production HTTP checks | 8/8 PASS |

HTTP checks covered login rendering, Google as the sole provider, CSRF token
issuance, anonymous sessions, login redirects for the payments page/payment API/
private invoice document, and minimal public health without diagnostics. The
probe initially expected Google's provider type to be `oauth`; inspection of
installed Auth.js showed the correct type is `oidc`. Correcting that probe
assertion yielded all eight passing checks; no application change was needed.

The Nodemailer alias remains a workable separation from NextAuth's optional
older email-login peer. This app uses Google OIDC; no email-login provider was
added. Current resolved versions remain NextAuth 5.0.0-beta.32 / @auth/core 0.41.3.
No mailer, auth-peer or recipient-override regression was found in the checks
performed. This does not prove a real Google OAuth round trip, external SMTP/TLS
delivery, production behavior, or live invoice/billing execution.

## Next implementation/release gate

1. Upgrade Next.js and its ESLint config to 16.4.2; refresh ip-address to 10.7.4.
2. Resolve effect/state lint errors and the lifecycle UI/test contract in bounded
   changes; retain behavioral coverage, especially payment-repair throttling.
3. Repeat the audit and relevant clean install/test/lint/type/build/auth/SMTP
   checks on the final changed candidate. Record residual dev-only findings
   separately rather than claiming a completely clean audit.
4. Keep the intentional invoice recipient override. Do not run cron, charge,
   create invoices, replay webhooks, send real mail, or change accounts as tests.
5. Push/deployment remains explicitly prohibited. Local validation is not a
   release and does not remediate the running production deployment. Preserve
   other worktrees; no cleanup or merge is included.
