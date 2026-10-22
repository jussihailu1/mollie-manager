# Remaining development dependency review — 22 October 2026

The user's follow-up authorized reviewing and safely fixing the 13 remaining
development-only audit entries, without forced downgrades, push or deployment.
Reviewed source: `e2564cd`. This follows the
[security fixes](security-dependency-fixes-2026-10-22.md).

## Decision

Keep one scoped forward override: `@esbuild-kit/core-utils@3.3.2` resolves
`esbuild@0.25.12`. Remove its obsolete nested 0.18.20 copy and platform binaries
from the lockfile. No other package versions change. Drizzle stays on 0.31.11,
shadcn on 4.21.4, and Next/eslint-config-next on 16.4.2. No global esbuild override,
forced downgrade, prerelease adoption, tool removal or audit suppression.

This is a deliberately tested exception to the legacy loader's declared
`~0.18.20` dependency range, **not an upstream-supported compatible update**.
0.25.12 is already the version used directly by this Drizzle release. The
independent tsx esbuild 0.28.2 remains unchanged. Retain the override and its
compatibility tests until Drizzle removes or updates the deprecated loader; then
remove both after validating its replacement. Future package changes must pass
the installed-version guard and tooling tests again.

## Two underlying vulnerabilities, not thirteen independent flaws

| Chain | Before | After | Decision |
| --- | --- | --- | --- |
| esbuild → core-utils → esm-loader → drizzle-kit | 4 moderate package entries | 0 | Scoped forward override validated locally |
| braces → micromatch → fast-glob → Next ESLint/shadcn/ts-morph chains | 9 high package entries | 9 high | No patched braces release; retain and track upstream |

- [esbuild advisory](https://github.com/evanw/esbuild/security/advisories/GHSA-67mh-4wv8-2f99):
  versions through 0.24.2 expose development-server responses through permissive
  CORS; fixed in 0.25.0+. Loopback binding alone is not a mitigation because the
  documented attack originates from a web page visiting the local server.
  Inspection of this Drizzle release shows tsx registration for config/schema
  loading, and no external legacy-loader import in its bundled CLI. Actual
  exposure through the old serve API was not established; removing the old
  installed version still eliminates the vulnerable dependency.
- [braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm):
  deeply nested untrusted patterns can exhaust the stack. No patched release is
  listed; npm's latest remains 3.0.3. Latest micromatch 4.0.8 and fast-glob 3.3.3
  retain this chain. Latest shadcn 4.22.1 still depends on fast-glob, its registry
  and ts-morph 26; upgrading it alone would not remove this vulnerability.
- Latest stable drizzle-kit remains 0.31.11, with deprecated esm-loader/core-utils.
  Drizzle 1.0 prereleases are a migration, not a low-risk security patch.
- Newer ts-morph majors avoid fast-glob in their common package, but shadcn's
  declared range is 26.x. Overriding that major would add unrelated AST-tooling
  risk while other braces paths remain. Do not chase a smaller entry count.
- Reject npm's proposed downgrades to drizzle-kit 0.18.1, shadcn 1.0.0 and
  eslint-config-next 14.2.35. No custom braces fork or non-equivalent glob alias.
  Keep tooling inputs trusted pending an upstream fix; this is an exposure
  constraint, not a claim that the remaining advisory is fixed.

## Validation

Windows, Node 22.18.0 / npm 11.7.0. Fresh archive, no application `.env`, explicit
environment allowlist. Synthetic auth and loopback port-1 database configuration
only. Generation/check commands operate on disposable copies and never apply SQL.

- Clean `npm ci`: 738 packages; installed dependency tree valid. Resolving esbuild
  from core-utils itself confirms 0.25.12, not just a patched top-level copy.
- Production audit: **0 findings**. Full audit: **9 high / 0 moderate / 0 critical**,
  all development-only and all derived from the one braces advisory.
- Full suite: **523/523 pass**, including five new tooling tests: installed
  patched version, CJS TypeScript/source maps, ESM/top-level await, JSX options,
  malformed-TypeScript errors. The four transform tests passed before and after.
- Actual deprecated ESM loader: static/dynamic TypeScript imports and top-level
  await pass before and after with transform cache disabled.
- Drizzle config/schema loading, offline generation and snapshot check pass.
  Baseline and patched generated SQL are byte-identical; generated snapshots
  match after excluding their newly generated snapshot UUID.
- shadcn help, full ESLint, typecheck and default Turbopack build pass.
  No authenticated browser, live database or Drizzle Studio interaction is claimed.
- Primary checkout dependencies synchronized with the validated lockfile.

Evidence: `C:\Users\Jussi\Kify-Recovery\2026-10-22-dev-dependency-review`.
Isolated source: `C:\Users\Jussi\AppData\Local\Temp\kify-dev-dependency-review-20261022`.

Two validation-harness corrections are retained in the evidence: Drizzle check
requires a relative output path on Windows, and npm initially preserved stale
nested 0.18.20 lock entries despite the override. The latter was detected by
`npm ls`, not accepted as a valid candidate. Removed only those nested lock
records, regenerated with npm, then repeated clean install and all checks on the
actual patched tree. No unrelated resolution changed. The five-test guard now
detects this installed-version failure as well.

## Separate existing migration snapshot debt

Subsequently repaired locally at the user's request; see the
[snapshot repair and validation](migration-snapshot-repair-2026-10-22.md).
The following preserves the original finding.

The baseline already generates a new 0030 migration duplicating schema changes
represented by hand-written migrations 0027–0029: activation jobs/notifications,
nullable webhook mode and tenant tax treatment. The latest checked-in snapshot
is 0026. The patched tooling produces exactly the same result; this is not an
override regression. `drizzle-kit check` passes but does not detect this semantic
snapshot drift. Keep generated artifacts outside the repository; **do not apply
the generated duplicate migration**. Reconcile snapshot history in a separate
bounded task before the next schema-generation change. No DB or migration source
was changed here.

Production remains unchanged. No push/deploy, billing, provider repair, invoices,
webhook replay, external email or account operation occurred.
