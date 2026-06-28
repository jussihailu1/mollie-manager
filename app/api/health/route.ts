import { checkDatabaseConnection } from "@/lib/db";
import { env, getSetupStatus, type MollieMode } from "@/lib/env";
import { getAcceptedCronSecrets, isBearerAuthorized } from "@/lib/cron-auth";
import { isMollieConfigured } from "@/lib/mollie/client";
import { notificationsAreConfigured } from "@/lib/notifications/email";
import { getViewerSession, hasAdvancedOperationsAccess } from "@/lib/auth/session";
import { getReliabilityOpsSnapshot } from "@/lib/reliability/ops-snapshot";
import { getCurrentTenantSelectionForViewer } from "@/lib/tenant-context";

function resolveMode(request: Request): MollieMode {
  const mode = new URL(request.url).searchParams.get("mode");
  if (mode === "live" || mode === "test") {
    return mode;
  }

  return env.MOLLIE_DEFAULT_MODE;
}

async function resolveDiagnosticsContext(request: Request) {
  const secrets = getAcceptedCronSecrets({
    cronSecret: process.env.CRON_SECRET ?? null,
    invoiceCronSharedSecret: env.INVOICE_CRON_SHARED_SECRET,
  });

  if (isBearerAuthorized(request.headers.get("authorization"), secrets)) {
    return {
      authorized: true,
      tenantId: null,
    };
  }

  const session = await getViewerSession();
  if (!hasAdvancedOperationsAccess(session)) {
    return {
      authorized: false,
      tenantId: null,
    };
  }

  const tenantSelection = await getCurrentTenantSelectionForViewer();

  return {
    authorized: true,
    tenantId: tenantSelection.currentTenant.id,
  };
}

export async function GET(request: Request) {
  const diagnosticsContext = await resolveDiagnosticsContext(request);

  if (!diagnosticsContext.authorized) {
    return Response.json({
      app: "Kify",
      status: "ok",
      timestamp: new Date().toISOString(),
    });
  }

  const mode = resolveMode(request);
  const setupStatus = getSetupStatus();
  const [database, opsSnapshot] = await Promise.all([
    checkDatabaseConnection(),
    getReliabilityOpsSnapshot({ mode, tenantId: diagnosticsContext.tenantId ?? undefined }),
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
    invoiceAutomation: opsSnapshot.invoiceAutomation,
    invoiceAutomationCron: opsSnapshot.invoiceAutomationCron,
    invoiceDeliveryQueue: opsSnapshot.invoiceDeliveryQueue,
    opsSnapshot,
    reliability: opsSnapshot.reliability,
    setupStatus,
    timestamp: new Date().toISOString(),
  });
}
