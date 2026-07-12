#!/usr/bin/env node

import process from "node:process";

import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

function readArgument(name: string) {
  const index = process.argv.findIndex((value) => value === name);
  if (index === -1) {
    return null;
  }

  const value = process.argv[index + 1];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

async function run() {
  const { getPlatformReadiness, getTenantReadiness } = await import(
    "@/lib/tenant-readiness"
  );
  const tenantId = readArgument("--tenant-id");

  if (!tenantId) {
    console.error("Missing required --tenant-id argument.");
    process.exitCode = 1;
    return;
  }

  const [platform, tenant] = await Promise.all([
    Promise.resolve(getPlatformReadiness()),
    getTenantReadiness(tenantId),
  ]);
  const report = {
    pass: platform.pass && tenant.pass,
    platform,
    tenant,
    tenantId,
    timestamp: new Date().toISOString(),
  };

  console.log(JSON.stringify(report, null, 2));

  if (!report.pass) {
    process.exitCode = 1;
  }
}

void run();
