# Migration snapshot repair — 22 October 2026

Status: repaired and validated locally; no database operations, push or deployment.
The user requested repair of the snapshot debt found in the
[development dependency review](dev-dependency-review-2026-10-22.md).
Baseline commit: `c485cd9`.

## Repair

- Added `0027_snapshot.json`, linked to existing 0026, containing only the two
  activation tables from migration 0027, including columns, defaults, foreign
  keys, uniqueness and indexes.
- Added 0028, linked to 0027, changing only webhook mode nullability. Migration
  0028's data correction remains in its original SQL; snapshots describe schema.
- Added 0029, linked to 0028, adding nullable tenant tax treatment and its
  `kor`/`standard` check constraint. Added the missing check declaration to
  `db/schema.ts` to reflect the constraint already specified in migration 0029.
  This does not introduce a new database constraint or migration.
- Preserved every existing SQL file, journal entry, timestamp, snapshot and ID.
  SHA-256 checks confirmed all 36 existing migration/metadata files unchanged.
  Historical sparse checkpoints before 0027 were not rewritten.
- Added `npm run db:check-snapshots`, also covered by the full Node suite. It
  checks checkpoint links, coverage of the latest journal entry, JSON-serialized
  schema equality, and the exact scope of the three restored checkpoints.
  It does not import application configuration, load `.env`, connect to a
  database, or execute SQL. Equality ignores only snapshot IDs/parent IDs and
  omits undefined fields as Drizzle's JSON writer does.

Reconstruction copied the two table definitions and tax field/check from
Drizzle's current serializer into successive copies of 0026; each step received
a new UUID and the correct parent ID. Reviewed generated transition statements
against the original hand-written SQL. The final snapshot matches the current
schema structurally and produces an empty Drizzle migration diff.

## Validation

- Fresh isolated archive plus source overlay; clean `npm ci`, 738 packages.
  Node 22.18.0 / npm 11.7.0; no application `.env` copied and child processes
  receive an explicit OS environment allowlist. No database credentials needed
  for snapshot/generation checks.
- Real `drizzle-kit generate` with explicit schema/dialect/output flags twice:
  **No schema changes, nothing to migrate**. No new SQL, snapshot or journal edit.
- `drizzle-kit check`: pass. Offline snapshot guard: **5/5 pass**.
- Deliberately corrupted webhook nullability in the isolated final snapshot:
  guard exits nonzero; original bytes restored in `finally`. All copied migration
  files hash identically before and after the complete verification.
- Full suite: **528/528 pass**. ESLint, typecheck and default Turbopack build pass.
- No dependency versions, installed security mitigations, billing behavior,
  invoice-recipient configuration or production state changed. The nine
  development-only braces findings remain a separate upstream dependency issue.

Evidence and reconstruction/verification scripts:
`C:\Users\Jussi\Kify-Recovery\2026-10-22-snapshot-repair`.
Isolated validation source:
`C:\Users\Jussi\AppData\Local\Temp\kify-snapshot-repair-20261022`.

The first draft guard compared in-memory optional undefined fields against
persisted JSON and failed. Normalizing through JSON serialization corrected the
comparison without ignoring real schema fields; the deliberate-drift check
confirms mismatches still fail.

## Maintenance

For future schema changes, review SQL, schema declaration and snapshot together.
Run the offline guard after generation, including after hand-written migrations.
Do not rewrite applied migrations or regenerate duplicate SQL to satisfy a check.
This repair establishes consistency of repository metadata and source; it does
not claim a fresh comparison with a live database. No migration needs applying
for this metadata repair.

Reference: Drizzle's [generation workflow](https://orm.drizzle.team/docs/drizzle-kit-generate)
compares the current schema snapshot with recorded snapshots; its separate
[check command](https://orm.drizzle.team/docs/drizzle-kit-check) is not a replacement
for the new schema-equality guard.
