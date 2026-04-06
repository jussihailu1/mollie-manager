import { checkDatabaseConnection } from "@/lib/db";
import { env, getSetupStatus } from "@/lib/env";
import { isMollieConfigured } from "@/lib/mollie/client";
import { notificationsAreConfigured } from "@/lib/notifications/email";
import { getReliabilitySnapshot } from "@/lib/reliability/data";

export async function GET() {
  const setupStatus = getSetupStatus();
  const [database, reliability] = await Promise.all([
    checkDatabaseConnection(),
    getReliabilitySnapshot(),
  ]);

  return Response.json({
    app: "Mollie Manager",
    currentMode: env.MOLLIE_DEFAULT_MODE,
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
    reliability,
    setupStatus,
    timestamp: new Date().toISOString(),
  });
}
