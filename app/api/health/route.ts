import { checkDatabaseConnection } from "@/lib/db";
import { env, getSetupStatus, type MollieMode } from "@/lib/env";
import {
  getInvoiceAutomationCronHeartbeat,
  getInvoiceAutomationSnapshot,
} from "@/lib/invoice-automation-metrics";
import { getInvoiceDeliveryQueueSummary } from "@/lib/invoice-delivery";
import { getAcceptedCronSecrets, isBearerAuthorized } from "@/lib/cron-auth";
import { isMollieConfigured } from "@/lib/mollie/client";
import { notificationsAreConfigured } from "@/lib/notifications/email";
import { getReliabilitySnapshot } from "@/lib/reliability/data";

function resolveMode(request: Request): MollieMode {
  const mode = new URL(request.url).searchParams.get("mode");
  if (mode === "live" || mode === "test") {
    return mode;
  }

  return env.MOLLIE_DEFAULT_MODE;
}

function isDiagnosticsAuthorized(request: Request) {
  const secrets = getAcceptedCronSecrets({
    cronSecret: process.env.CRON_SECRET ?? null,
    invoiceCronSharedSecret: env.INVOICE_CRON_SHARED_SECRET,
  });

  return isBearerAuthorized(request.headers.get("authorization"), secrets);
}

export async function GET(request: Request) {
  if (!isDiagnosticsAuthorized(request)) {
    return Response.json({
      app: "Kify",
      status: "ok",
      timestamp: new Date().toISOString(),
    });
  }

  const mode = resolveMode(request);
  const setupStatus = getSetupStatus();
  const [
    database,
    reliability,
    invoiceAutomation,
    invoiceAutomationCron,
    invoiceDeliveryQueue,
  ] = await Promise.all([
    checkDatabaseConnection(),
    getReliabilitySnapshot({ mode }),
    getInvoiceAutomationSnapshot(mode),
    getInvoiceAutomationCronHeartbeat(mode),
    getInvoiceDeliveryQueueSummary(mode),
  ]);

  return Response.json({
    app: "Kify",
    currentMode: mode,
    phase: "reliability",
    status:
      database.ok && Object.values(setupStatus).every((section) => section.ready)
        ? "ok"
        : "setup-pending",
    checks: {
      database,
      mollieLiveConfigured: isMollieConfigured("live"),
      notificationsConfigured: notificationsAreConfigured(),
      mollieTestConfigured: isMollieConfigured("test"),
    },
    invoiceAutomation,
    invoiceAutomationCron,
    invoiceDeliveryQueue,
    reliability,
    setupStatus,
    timestamp: new Date().toISOString(),
  });
}
