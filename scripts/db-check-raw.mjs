import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

const execFileAsync = promisify(execFile);

const allowedFiles = new Set(
  [
    "db/schema.ts",
    "drizzle.config.ts",
    "lib/db.ts",
    "scripts/db-apply.mjs",
    "scripts/db-check-raw.mjs",
    "scripts/db-smoke.mjs",
  ].map((filePath) => path.normalize(filePath)),
);

const allowedPrefixes = ["db/drizzle/", "db/migrations/"].map((prefix) =>
  path.normalize(prefix),
);

const bannedPatterns = [
  {
    label: "direct pg import",
    pattern: /(?:from\s+["']pg["']|require\(["']pg["']\))/,
  },
  {
    label: "direct query call",
    pattern: /\.\s*query\s*\(/,
  },
  {
    label: "legacy query helper call",
    pattern: /(?<![.\w])query\s*(?:<[^>]+>)?\s*\(/,
  },
  {
    label: "unsafe Drizzle raw SQL",
    pattern: /\bsql\s*\.\s*raw\s*\(/,
  },
];

function isAllowed(filePath) {
  const normalized = path.normalize(filePath);

  if (allowedFiles.has(normalized)) {
    return true;
  }

  return allowedPrefixes.some((prefix) => normalized.startsWith(prefix));
}

const { stdout } = await execFileAsync("git", [
  "ls-files",
  "*.ts",
  "*.tsx",
  "*.js",
  "*.mjs",
]);

const violations = [];

for (const filePath of stdout.split(/\r?\n/).filter(Boolean)) {
  if (isAllowed(filePath)) {
    continue;
  }

  const content = await readFile(filePath, "utf8");
  const lines = content.split(/\r?\n/);

  for (const [lineIndex, line] of lines.entries()) {
    for (const bannedPattern of bannedPatterns) {
      if (bannedPattern.pattern.test(line)) {
        violations.push({
          filePath,
          label: bannedPattern.label,
          line: lineIndex + 1,
          text: line.trim(),
        });
      }
    }
  }
}

if (violations.length > 0) {
  console.error("Raw database access guard failed:");

  for (const violation of violations) {
    console.error(
      `${violation.filePath}:${violation.line} ${violation.label}: ${violation.text}`,
    );
  }

  process.exitCode = 1;
} else {
  console.log("Raw database access guard passed.");
}
