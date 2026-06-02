#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const mode = process.argv[2] === "live" ? "live" : "test";
const applyRequeue = process.argv.includes("--apply-requeue");
const runCronCheck = process.argv.includes("--run-cron-check");

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

function run() {
  const requeueArgs = ["scripts/invoice-automation-requeue-safe-failed.mjs", mode];
  if (applyRequeue) {
    requeueArgs.push("--apply");
  }
  const requeueRun = runScript("node", requeueArgs);
  const requeueJson = safeJsonParseFromOutput(requeueRun.stdout);

  let cronCheckRun = null;
  let cronCheckJson = null;
  if (runCronCheck) {
    cronCheckRun = runScript("node", [
      "scripts/invoice-automation-check.mjs",
      mode,
      "25",
    ]);
    cronCheckJson = safeJsonParseFromOutput(cronCheckRun.stdout);
  }

  const backlogRun = runScript("node", [
    "scripts/invoice-automation-backlog.mjs",
    mode,
    "50",
  ]);
  const backlogJson = safeJsonParseFromOutput(backlogRun.stdout);

  const report = {
    mode,
    options: {
      applyRequeue,
      runCronCheck,
    },
    sections: {
      backlog: {
        exitCode: backlogRun.code,
        summary: backlogJson?.summary ?? null,
      },
      cronCheck: runCronCheck
        ? {
            exitCode: cronCheckRun?.code ?? 1,
            status: cronCheckJson?.cronResult?.status ?? null,
          }
        : null,
      requeue: {
        exitCode: requeueRun.code,
        queued: requeueJson?.queued ?? null,
      },
    },
    timestamp: new Date().toISOString(),
  };

  console.log(JSON.stringify(report, null, 2));

  const failed =
    requeueRun.code !== 0 ||
    backlogRun.code !== 0 ||
    (runCronCheck && (cronCheckRun?.code ?? 1) !== 0);
  if (failed) {
    process.exitCode = 1;
  }
}

run();
