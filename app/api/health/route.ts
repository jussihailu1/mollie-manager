import { checkDatabaseConnection } from "@/lib/db";
import { env, type MollieMode } from "@/lib/env";
import { getAcceptedCronSecrets, isBearerAuthorized } from "@/lib/cron-auth";
import {
  getPlatformReadiness,
  getTenantReadiness,
} from "@/lib/tenant-readiness";
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

function resolveRequestedTenantId(request: Request) {
  const tenantId = new URL(request.url).searchParams.get("tenantId")?.trim();
  return tenantId ? tenantId : null;
}

async function resolveDiagnosticsContext(request: Request) {
  const secrets = getAcceptedCronSecrets({
    cronSecret: process.env.CRON_SECRET ?? null,
    invoiceCronSharedSecret: env.INVOICE_CRON_SHARED_SECRET,
  });
  const requestedTenantId = resolveRequestedTenantId(request);

  if (isBearerAuthorized(request.headers.get("authorization"), secrets)) {
    return {
      authorized: true,
      tenantId: requestedTenantId,
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
  const tenantId = requestedTenantId
    ? tenantSelection.accessibleTenants.find(
        (tenant) => tenant.id === requestedTenantId,
      )?.id ?? null
    : null;

  return {
    authorized: true,
    tenantId,
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

  const requestedTenantId = resolveRequestedTenantId(request);
  const mode = diagnosticsContext.tenantId ? "live" : resolveMode(request);
  const platform = getPlatformReadiness();
  const database = await checkDatabaseConnection();
  const opsSnapshot = diagnosticsContext.tenantId
    ? await getReliabilityOpsSnapshot({
        mode,
        tenantId: diagnosticsContext.tenantId,
      })
    : null;
  const tenant =
    diagnosticsContext.tenantId !== null
      ? await getTenantReadiness(diagnosticsContext.tenantId)
      : null;
  const status =
    database.ok &&
    platform.pass &&
    (requestedTenantId === null || Boolean(tenant?.pass))
      ? "ok"
      : "setup-pending";

  return Response.json({
    app: "Kify",
    currentMode: mode,
    diagnosticsTenantId: diagnosticsContext.tenantId,
    diagnosticsTenantScoped: Boolean(diagnosticsContext.tenantId),
    diagnosticsNotice: diagnosticsContext.tenantId
      ? null
      : "Pass ?tenantId=<tenant-id> to read tenant-scoped live readiness and reliability diagnostics.",
    phase: "reliability",
    status,
    checks: {
      database,
    },
    invoiceAutomation: opsSnapshot?.invoiceAutomation ?? null,
    invoiceAutomationCron: opsSnapshot?.invoiceAutomationCron ?? null,
    invoiceDeliveryQueue: opsSnapshot?.invoiceDeliveryQueue ?? null,
    opsSnapshot,
    platform,
    reliability: opsSnapshot?.reliability ?? null,
    tenant,
    timestamp: new Date().toISOString(),
  });
}
