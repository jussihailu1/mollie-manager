import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";

const source = readFileSync(resolve("scripts/retention-report.mjs"), "utf8");
const packageJson = JSON.parse(readFileSync(resolve("package.json"), "utf8"));

describe("retention report scope", () => {
  it("fails closed for missing or invalid report scope", () => {
    assert.match(source, /if \(!REPORT_KINDS\.has\(value\)\)/);
    assert.match(source, /if \(value === undefined \|\| value === ""\)/);
    assert.match(source, /parseRetentionMode\(value\)/);
    assert.match(source, /reportKind === "candidates" && mode === "all"/);
    assert.match(source, /explicit live or test mode/);
  });

  it("uses policy-owned fixed windows and the TypeScript loader", () => {
    assert.match(source, /import retentionPolicy from "\.\.\/lib\/retention-policy\.ts"/);
    assert.match(source, /RETENTION_WINDOWS\.auditDetails/);
    assert.match(source, /RETENTION_WINDOWS\.acceptedConsentClientDataMonths/);
    assert.match(source, /RETENTION_WINDOWS\.processedWebhookPayload/);
    assert.match(source, /interval '12 months'/);
    assert.match(source, /interval '180 days'/);
    assert.doesNotMatch(source, /RETENTION_(?:AUDIT|CONSENT|WEBHOOK)_DAYS/);
    assert.equal(
      packageJson.scripts["ops:retention-report"],
      "node --import tsx scripts/retention-report.mjs",
    );
  });

  it("loads the TypeScript policy module at runtime before failing closed", () => {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/retention-report.mjs", "invalid", "live"],
      { encoding: "utf8" },
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /report kind must be one of/);
    assert.doesNotMatch(result.stderr, /does not provide an export/);
  });

  it("enforces a bounded read-only transaction", () => {
    assert.match(source, /client\.query\("BEGIN READ ONLY"\)/);
    assert.match(source, /SET LOCAL statement_timeout/);
    assert.match(source, /client\.query\("ROLLBACK"\)/);
    assert.doesNotMatch(source, /\b(?:UPDATE|DELETE|TRUNCATE)\b/);
    assert.match(source, /proposedMutations: 0/);
  });

  it("emits aggregate candidates without sensitive row values", () => {
    assert.match(source, /count\(\*\) filter/g);
    assert.match(source, /processing_status = 'processed'/);
    assert.match(source, /retry_count = 0/);
    assert.match(source, /accepted_ip is not null or accepted_user_agent is not null/);
    assert.doesNotMatch(source, /select\s+(?:id|payload|actor_email|error_message)/i);
    assert.doesNotMatch(source, /min\(|max\(/i);
  });

  it("preserves evidence and blocks unapproved cleanup categories", () => {
    assert.match(source, /auditDetails: \{/);
    assert.match(source, /candidateCount: auditResult\.rows/);
    assert.match(source, /core_evidence_count/);
    assert.match(source, /processing_status = 'failed'/);
    assert.match(source, /unresolved_failed_preserved_count/);
    assert.match(source, /blockedPendingAllowlists/);
    assert.match(source, /genericMetadata: "Blocked/);
    assert.match(source, /testOperationalData: "Blocked/);
    assert.match(source, /evidenceImpact/);
    assert.match(source, /intendedAction/);
  });
});
