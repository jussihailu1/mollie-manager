#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const mode = process.argv[2] === "live" ? "live" : "test";
const backlogLimit = Math.max(1, Math.min(500, Number(process.argv[3] ?? "50")));
const gateLimit = Math.max(1, Math.min(200, Number(process.argv[4] ?? "25")));

function runScript(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  return {
    code: result.status ?? 1,
    stderr: result.stderr ?? "",
    stdout: result.stdout ?? "",
  };
}

function safeJsonParseFromOutput(output) {
  const trimmed = output.trim();
  if (!trimmed) {
    return null;
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
    return null;
  }

  const jsonCandidate = trimmed.slice(firstBrace, lastBrace + 1);
  try {
    return JSON.parse(jsonCandidate);
  } catch {
    return null;
  }
}

function summarizeBacklog(backlog) {
  if (!backlog || typeof backlog !== "object") {
    return null;
  }

  const summary = backlog.summary ?? {};
  const failedTotal =
    Number(summary.failedFirstPaymentCount ?? 0) +
    Number(summary.failedRecurringCount ?? 0);
  const unsentTotal =
    Number(summary.unsentFirstPaymentCreatedCount ?? 0) +
    Number(summary.unsentRecurringCreatedCount ?? 0);
  const permanentTotal =
    Number(summary.unsentFirstPaymentPermanentCount ?? 0) +
    Number(summary.unsentRecurringPermanentCount ?? 0);

  return {
    failedTotal,
    permanentDeliveryFailureTotal: permanentTotal,
    unsentCreatedTotal: unsentTotal,
  };
}

function run() {
  const readinessRun = runScript("node", [
    "scripts/invoice-automation-readiness.mjs",
    mode,
  ]);
  const readinessJson = safeJsonParseFromOutput(readinessRun.stdout);

  const backlogRun = runScript("node", [
    "scripts/invoice-automation-backlog.mjs",
    mode,
    String(backlogLimit),
  ]);
  const backlogJson = safeJsonParseFromOutput(backlogRun.stdout);

  const gateRun = runScript("node", [
    "scripts/invoice-automation-gate.mjs",
    mode,
    String(gateLimit),
  ]);
  const gateJson = safeJsonParseFromOutput(gateRun.stdout);

  const readinessPass = readinessJson?.pass === true;
  const gatePass = gateRun.code === 0 && gateJson?.pass === true;
  const backlogSummary = summarizeBacklog(backlogJson);
  const backlogPass = backlogSummary
    ? backlogSummary.permanentDeliveryFailureTotal === 0
    : false;

  const overallPass = readinessPass && gatePass && backlogPass;

  const report = {
    mode,
    overallPass,
    sections: {
      backlog: {
        exitCode: backlogRun.code,
        pass: backlogPass,
        summary: backlogSummary,
      },
      gate: {
        exitCode: gateRun.code,
        pass: gatePass,
        reason:
          gateRun.code !== 0 && !gateJson
            ? "Gate command did not produce JSON output (likely missing env)."
            : null,
      },
      readiness: {
        exitCode: readinessRun.code,
        pass: readinessPass,
      },
    },
    timestamp: new Date().toISOString(),
  };

  console.log(JSON.stringify(report, null, 2));

  if (!overallPass) {
    process.exitCode = 1;
  }
}

run();
