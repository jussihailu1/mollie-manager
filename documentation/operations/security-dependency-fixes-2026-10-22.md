# Dependency-security fixes — 22 October 2026

Status: local implementation and validation; **not pushed or deployed**.
Follow-up: the [development dependency review](dev-dependency-review-2026-10-22.md)
removes the four esbuild-chain findings with a tested scoped override; nine
braces-derived findings remain. The counts below are this earlier validation.
The user authorized fixing the remaining issue 4 findings and separate local
dependency and UI/test commits. This supersedes the candidate-readiness findings
in the [earlier review](security-dependency-review-2026-10-22.md), retained as
historical evidence. Production was last verified at `1179c82`; no production
check or mutation was performed during this implementation.

## Changes and commit boundaries

- Dependency-only commit `3c263b9`: exact Next.js and eslint-config-next pins
  16.4.0 → 16.4.2, matching Next packages, compatible development-only
  ip-address 10.7.3 → 10.7.4. npm also normalized bundled optional Tailwind WASM
  metadata; Tailwind itself was not upgraded. No forced overrides/downgrades.
- Separate UI/test commit: customer/payment/consent sessions reset on close or
  identity change. Customer reads have stable primitive identities, abort on
  cleanup and ignore late results. Loading/error/data now belong to the request
  resource, subscribed through React's external-store hook. Billing history
  responds when the customer's first billing record appears. A refreshed server
  payment snapshot explicitly invalidates payment details, preserving invoice
  updates and repair retry opportunities even when lastSyncedAt is unchanged.
- Consent success is derived from the action result. Pending-plan reads no
  longer overwrite form edits when a parent refresh supplies the same customer.
  Selecting a different customer in edit mode clears the old plan/error and
  disables submission until that customer's plan loads.
- Automatic payment repair waits for details and deduplicates an in-flight POST
  by payment ID across remounts. The existing fingerprint/localStorage five-minute
  retry throttle is preserved for successes and failures. Unavailable storage
  fails closed. Closing a drawer cancels its read/display subscription, not an
  already submitted repair. This code was tested with stubbed requests only.
- The customer drawer again displays the derived lifecycle summary and a readable
  reason. Existing lifecycle assertions were strengthened, not removed. Two
  endpoint source assertions now follow the shared encoded customer path.
- Removed unused imports/destructuring; internal settings navigation uses the
  router. ESLint ignores the existing generated `.artifacts` directory without
  disabling any rules. No invoice logic or recipient override changed.

## Validation and evidence

Node 22.18.0 / npm 11.7.0. Fresh source archive plus explicit changed-source
overlay, own clean dependency installation, no application `.env` files.
Commands received only an OS environment allowlist and synthetic local auth
configuration. No database, provider or external SMTP credentials were supplied.

- Source: `C:\Users\Jussi\AppData\Local\Temp\kify-security-fixes-20261022`
- Logs, audits, per-command JSON results and local HTTP probe:
  `C:\Users\Jussi\Kify-Recovery\2026-10-22-security-fixes`
- Clean `npm ci`: passed, 740 packages, no peer-resolution failure.
  The primary checkout's installed dependencies were also synchronized with
  `npm ci` under the same sanitized environment; package files stayed unchanged.
  Its install evidence is in the `checkout-install` subdirectory.
  Full checkout lint also passes with zero errors/warnings.
- Production audit: **0 vulnerabilities**.
- Full audit: **13 development-only package entries: 9 high, 4 moderate**.
  These include propagation through dependency chains, not 13 distinct flaws.
- Full Node suite: **518/518 pass**. Seven new behavior tests cover request
  identity, cancellation/late completion, Strict Mode restart, failures,
  concurrent repair deduplication, persisted throttling/expiry and storage failure.
  Loopback SMTP integration remains **2/2 passing**, with no external mail sent.
- Full ESLint: **0 errors / 0 warnings**. Typecheck and default Turbopack
  production build pass. Installed dependency tree has no invalid peer tree;
  Nodemailer remains 10.0.16 under `nodemailer-smtp`, with no legacy mailer.
- Local production HTTP checks: **8/8 pass**: login, sole Google OIDC provider,
  CSRF, anonymous session, protected payment page/API and invoice-document
  redirects, minimal public health response. Server stopped after the probes.
- The first test run passed 516/518; two source-text assertions referenced the
  old inline endpoint construction. Updated those assertions to retain encoded
  customer scoping and resource/refresh checks. The original failure log is kept.

## Remaining boundaries and follow-up

- Braces/fast-glob/micromatch tooling chain remains high; the current audit has
  no patched braces release. Drizzle-kit's deprecated loader retains nested
  esbuild 0.18.20 (moderate). No supported compatible fix was found in the review.
  Keep these development tools private and do not feed them untrusted input;
  revisit upstream patches. Do not run `npm audit fix --force` to hide findings.
- Local checks do not prove a real Google OAuth round trip, external SMTP/TLS
  delivery, authenticated browser interaction, or production behavior. No live
  billing, repair, invoice creation, webhook replay, email or account operation
  was used as validation.
- Push and deployment remain prohibited. The existing security implementation
  `4cb19ed` plus these follow-ups remain local. A later release needs explicit
  authorization and deployment/production verification; local validation does
  not patch the currently running application.
- Issue 1 URL correction remains complete; genuine webhook receipt/processing
  remains unproven. Monitoring and operator inbox proof remain separate work.

Implementation reference: React's documented
[useSyncExternalStore contract](https://react.dev/reference/react/useSyncExternalStore).
Current advisory links and residual-chain analysis are in the earlier review.
