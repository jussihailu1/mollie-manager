#!/usr/bin/env node

const appUrl = process.env.APP_URL ?? process.env.AUTH_URL;
const cronSecret =
  process.env.INVOICE_CRON_SHARED_SECRET ?? process.env.CRON_SECRET;
const mode = process.env.MOLLIE_MODE ?? process.argv[2] ?? "live";
const limit = Number(process.env.INVOICE_CRON_LIMIT ?? process.argv[3] ?? "25");

const maxUnresolvedAlerts = Number(
  process.env.INVOICE_GATE_MAX_UNRESOLVED_ALERTS ?? process.argv[4] ?? "5",
);
const maxPermanentFailures = Number(
  process.env.INVOICE_GATE_MAX_PERMANENT_FAILURES ?? process.argv[5] ?? "0",
);
const maxDueDeliveryRetries = Number(
  process.env.INVOICE_GATE_MAX_DUE_DELIVERY_RETRIES ?? process.argv[6] ?? "10",
);

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

function toNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return 0;
}

function buildCheck(name, pass, details) {
  return {
    details,
    name,
    pass,
  };
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

  const afterAutomation = healthAfter.invoiceAutomation ?? {};
  const afterDeliveryQueue = healthAfter.invoiceDeliveryQueue ?? {};
  const afterReliability = healthAfter.reliability ?? {};

  const permanentFailureTotal =
    toNumber(afterDeliveryQueue.permanentFailureFirstPaymentCount) +
    toNumber(afterDeliveryQueue.permanentFailureRecurringCount);
  const dueDeliveryRetryTotal =
    toNumber(afterDeliveryQueue.dueRetryFirstPaymentCount) +
    toNumber(afterDeliveryQueue.dueRetryRecurringCount);

  const checks = [
    buildCheck("cron_status_ok", cronResult.status === "ok", {
      cronStatus: cronResult.status ?? null,
    }),
    buildCheck(
      "unresolved_alerts_within_threshold",
      toNumber(afterReliability.unresolvedAlertCount) <= maxUnresolvedAlerts,
      {
        maxUnresolvedAlerts,
        unresolvedAlertCount: toNumber(afterReliability.unresolvedAlertCount),
      },
    ),
    buildCheck(
      "permanent_delivery_failures_within_threshold",
      permanentFailureTotal <= maxPermanentFailures,
      {
        maxPermanentFailures,
        permanentFailureTotal,
      },
    ),
    buildCheck(
      "due_delivery_retries_within_threshold",
      dueDeliveryRetryTotal <= maxDueDeliveryRetries,
      {
        dueDeliveryRetryTotal,
        maxDueDeliveryRetries,
      },
    ),
    buildCheck(
      "failed_invoice_backlog_not_increasing",
      toNumber(afterAutomation.failedFirstPaymentCount) +
        toNumber(afterAutomation.failedRecurringCount) <=
        toNumber(healthBefore.invoiceAutomation?.failedFirstPaymentCount) +
          toNumber(healthBefore.invoiceAutomation?.failedRecurringCount),
      {
        afterFailedTotal:
          toNumber(afterAutomation.failedFirstPaymentCount) +
          toNumber(afterAutomation.failedRecurringCount),
        beforeFailedTotal:
          toNumber(healthBefore.invoiceAutomation?.failedFirstPaymentCount) +
          toNumber(healthBefore.invoiceAutomation?.failedRecurringCount),
      },
    ),
  ];

  const pass = checks.every((check) => check.pass);
  const report = {
    appUrl,
    checks,
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
    limit,
    mode,
    pass,
    thresholds: {
      maxDueDeliveryRetries,
      maxPermanentFailures,
      maxUnresolvedAlerts,
    },
    timestamp: new Date().toISOString(),
  };

  console.log(JSON.stringify(report, null, 2));

  if (!pass) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error("invoice-automation-gate failed");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
