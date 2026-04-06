import { checkDatabaseConnection } from "@/lib/db";
import { env, getSetupStatus } from "@/lib/env";
import { isMollieConfigured } from "@/lib/mollie/client";

export async function GET() {
  const setupStatus = getSetupStatus();
  const database = await checkDatabaseConnection();

  return Response.json({
    app: "Mollie Manager",
    currentMode: env.MOLLIE_DEFAULT_MODE,
    phase: "platform",
    status:
      database.ok && Object.values(setupStatus).every((section) => section.ready)
        ? "ok"
        : "setup-pending",
    checks: {
      database,
      mollieLiveConfigured: isMollieConfigured("live"),
      mollieTestConfigured: isMollieConfigured("test"),
    },
    setupStatus,
    timestamp: new Date().toISOString(),
  });
}
