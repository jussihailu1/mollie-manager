# Dependency security update — 8 October 2026

Status: local implementation and runtime validation complete; full-lint
limitations recorded below. No push or deployment.

## Change

The user requested remediation of the production dependency audit findings.
The original lockfile reported 10 affected package entries: 1 critical, 8 high
and 1 moderate. Next.js 16.2.2 and Nodemailer 7.0.13 were among the affected
runtime dependencies. Counts include inherited/transitive entries; they do not
prove application exploitation.

- Update Next.js and eslint-config-next together to 16.4.0.
- Use Nodemailer 10.0.16 for app SMTP through `nodemailer-smtp`, an npm alias for
  the official `nodemailer` package. NextAuth 5.0.0-beta.32 and @auth/core 0.41.3
  only declare optional Nodemailer 7/8 email-login peers. This app uses Google
  OAuth, so those peers are not needed. The alias permits a supported clean npm
  installation without a vulnerable second mailer, peer overrides, force flags
  or an authentication downgrade. Do not add NextAuth email login without first
  revisiting its upstream Nodemailer compatibility.
- Remove @types/nodemailer and use Nodemailer's bundled types. Node.js 20+ is
  required by Nodemailer 10; Next.js already requires Node.js 20.9+.
- Refresh compatible vulnerable transitive dependencies, including Undici
  6.29.0 for Vercel Blob, source-map-js 1.2.2 and baseline-browser-mapping.
  Compatible development dependency updates are included in the lockfile.

The mail wrapper's behavior and invoice override remain unchanged. The user
explicitly confirmed `INVOICE_EMAIL_OVERRIDE_TO=info@ayalweb.com` is intentional
and correct. Do not remove it or send invoices directly to customers as part of
this update.

## Verification

- Updated production dependency audit: zero vulnerabilities.
- Baseline full Node suite, before changes: 508/509 pass. The existing
  `customer lifecycle UI surface` source assertion expects `lifecycle.summary`.
- Updated full Node suite: 510/511 pass; same sole baseline failure.
- New loopback SMTP integration checks pass with the installed Nodemailer:
  password authentication, intended recipient, text/HTML MIME, PDF attachment
  bytes and one-time SMTP rejection propagation. They use synthetic credentials
  and do not load application environment or send external mail.
- Existing focused auth, operator-notification and alert-delivery checks pass.
- Typecheck and scoped mailer/test ESLint pass.
- Clean `npm ci` and default production build pass in an isolated source copy
  on Node.js 22.18.0 with synthetic auth settings and no copied `.env` files.
  The clean installation also reports zero production audit findings and
  contains only Nodemailer 10.0.16 under its alias; no old optional mailer is
  installed for NextAuth.
- Local production HTTP checks pass: login renders; Google is the sole
  configured auth provider; CSRF works; anonymous sessions remain unauthenticated;
  protected payments and private invoice access redirect to login; public health
  exposes no diagnostics. The invoice smoke assertion initially expected 401;
  source review confirmed `requireViewerSession` intentionally returns a 307
  login redirect, which the corrected probe verified. No OAuth round trip,
  database operation, financial action or external email was exercised.
- Full lint is **not clean**. An isolated baseline installation has zero errors
  and ten warnings. The updated isolated installation has ten errors and eleven
  warnings: react-hooks 7.1.1 newly flags existing synchronous state updates in
  effects in `customer-flow-dialogs.tsx` and `payment-drawer.tsx`. These are
  diagnostics introduced by the tool upgrade, not passing baseline checks.
  A normal mixed checkout also lints an ignored `.artifacts` fixture, adding
  one unrelated error/warning. No lint rules were weakened and no UI behavior
  was changed to silence these findings; resolve them in a separate UI slice.

## Remaining development-only findings

The full audit still reports 13 package entries (9 high, 4 moderate), with no
critical findings. These are the unpatched `braces` dependency chain used by
ESLint/shadcn and the old esbuild chain inside drizzle-kit's deprecated loader.
They are absent from the production-only audit. No supported non-breaking fix
was offered for those remaining chains; suggested forced downgrades of shadcn
and drizzle-kit are not appropriate. Avoid exposing development tooling to
untrusted input/network access and track upstream fixes separately.

## Release

Review the final commit and release it separately. A push to master triggers
Vercel production deployment. After an authorized release, verify the actual
READY deployment SHA and non-billing health/authentication behavior. Do not run
the full billing cron, issue invoices or send mail just to test the upgrade.
Current local validation does not establish production remediation or a real
Google OAuth round trip.

The one-time cron observation is scheduled independently for 9 October at 06:15
Europe/Amsterdam; see the [cron release ledger](cron-reliability-release-2026-10-08.md).

## Upstream references

- [Next.js Server Actions advisory](https://github.com/vercel/next.js/security/advisories/GHSA-m99w-x7hq-7vfj)
- [Nodemailer changelog](https://github.com/nodemailer/nodemailer/blob/master/CHANGELOG.md)
- [npm package alias syntax](https://docs.npmjs.com/cli/v11/using-npm/package-spec/#aliases)
