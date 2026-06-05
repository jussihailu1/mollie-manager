#!/usr/bin/env node

const appUrl = process.env.APP_URL ?? process.env.AUTH_URL;
const cronSecret =
  process.env.INVOICE_CRON_SHARED_SECRET ?? process.env.CRON_SECRET;
const mode = process.env.MOLLIE_MODE ?? process.argv[2] ?? "test";
const limit = Number(process.env.INVOICE_CRON_LIMIT ?? process.argv[3] ?? "25");

if (!appUrl) {
  console.error("APP_URL or AUTH_URL is required.");
  process.exit(1);
}

if (!cronSecret) {
  console.error("INVOICE_CRON_SHARED_SECRET or CRON_SECRET is required.");
  process.exit(1);
}

if (mode !== "test" && mode !== "live") {
  console.error("Mode must be 'test' or 'live'.");
  process.exit(1);
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${JSON.stringify(body)}`);
  }

  return body;
}

async function run() {
  const healthHeaders = {
    Authorization: `Bearer ${cronSecret}`,
  };
  const healthBefore = await fetchJson(`${appUrl}/api/health?mode=${mode}`, {
    headers: healthHeaders,
  });
  const cronResult = await fetchJson(
    `${appUrl}/api/cron/recurring-invoices?mode=${mode}&limit=${Math.max(1, Math.trunc(limit))}`,
    {
      headers: {
        Authorization: `Bearer ${cronSecret}`,
      },
      method: "POST",
    },
  );
  const healthAfter = await fetchJson(`${appUrl}/api/health?mode=${mode}`, {
    headers: healthHeaders,
  });

  const report = {
    appUrl,
    cronResult,
    healthAfter: {
      invoiceAutomation: healthAfter.invoiceAutomation,
      invoiceDeliveryQueue: healthAfter.invoiceDeliveryQueue,
      reliability: healthAfter.reliability,
    },
    healthBefore: {
      invoiceAutomation: healthBefore.invoiceAutomation,
      invoiceDeliveryQueue: healthBefore.invoiceDeliveryQueue,
      reliability: healthBefore.reliability,
    },
    mode,
    timestamp: new Date().toISOString(),
  };

  console.log(JSON.stringify(report, null, 2));
}

run().catch((error) => {
  console.error("invoice-automation-check failed");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
