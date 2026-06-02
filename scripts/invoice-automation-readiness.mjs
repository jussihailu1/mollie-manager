#!/usr/bin/env node

import { readFileSync, existsSync } from "node:fs";

const mode = process.argv[2] === "live" ? "live" : "test";

function hasValue(name) {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0;
}

function pushCheck(checks, input) {
  checks.push({
    details: input.details ?? {},
    name: input.name,
    pass: input.pass,
  });
}

function inspectVercelCronConfig() {
  if (!existsSync("vercel.json")) {
    return {
      hasInvoiceCronPath: false,
      hasVercelJson: false,
      parseError: null,
    };
  }

  try {
    const content = readFileSync("vercel.json", "utf8");
    const parsed = JSON.parse(content);
    const crons = Array.isArray(parsed?.crons) ? parsed.crons : [];
    const hasInvoiceCronPath = crons.some(
      (cron) => cron?.path === "/api/cron/recurring-invoices",
    );

    return {
      cronCount: crons.length,
      hasInvoiceCronPath,
      hasVercelJson: true,
      parseError: null,
    };
  } catch (error) {
    return {
      hasInvoiceCronPath: false,
      hasVercelJson: true,
      parseError: error instanceof Error ? error.message : String(error),
    };
  }
}

function run() {
  const checks = [];
  const cronConfig = inspectVercelCronConfig();

  pushCheck(checks, {
    details: {
      hasAppUrl: hasValue("APP_URL"),
      hasAuthUrl: hasValue("AUTH_URL"),
    },
    name: "app_url_configured",
    pass: hasValue("APP_URL") || hasValue("AUTH_URL"),
  });

  pushCheck(checks, {
    details: {
      hasCronSecret: hasValue("CRON_SECRET"),
      hasInvoiceCronSharedSecret: hasValue("INVOICE_CRON_SHARED_SECRET"),
    },
    name: "cron_secret_configured",
    pass: hasValue("CRON_SECRET") || hasValue("INVOICE_CRON_SHARED_SECRET"),
  });

  pushCheck(checks, {
    details: {
      SMTP_FROM: hasValue("SMTP_FROM"),
      SMTP_HOST: hasValue("SMTP_HOST"),
      SMTP_PASSWORD: hasValue("SMTP_PASSWORD"),
      SMTP_PORT: hasValue("SMTP_PORT"),
      SMTP_USER: hasValue("SMTP_USER"),
    },
    name: "smtp_configured",
    pass:
      hasValue("SMTP_HOST") &&
      hasValue("SMTP_PORT") &&
      hasValue("SMTP_USER") &&
      hasValue("SMTP_PASSWORD") &&
      hasValue("SMTP_FROM"),
  });

  pushCheck(checks, {
    details: {
      hasToken: hasValue("EBOEKHOUDEN_API_TOKEN"),
    },
    name: "eboekhouden_token_configured",
    pass: hasValue("EBOEKHOUDEN_API_TOKEN"),
  });

  pushCheck(checks, {
    details: {
      MOLLIE_DEFAULT_MODE: process.env.MOLLIE_DEFAULT_MODE ?? null,
      mode,
    },
    name: "mollie_default_mode_matches_target",
    pass: (process.env.MOLLIE_DEFAULT_MODE ?? "test") === mode,
  });

  pushCheck(checks, {
    details: cronConfig,
    name: "scheduler_config_present",
    pass:
      cronConfig.hasVercelJson === true &&
      cronConfig.hasInvoiceCronPath === true &&
      !cronConfig.parseError,
  });

  const pass = checks.every((check) => check.pass);
  const report = {
    checks,
    mode,
    pass,
    timestamp: new Date().toISOString(),
  };

  console.log(JSON.stringify(report, null, 2));

  if (!pass) {
    process.exitCode = 1;
  }
}

run();
