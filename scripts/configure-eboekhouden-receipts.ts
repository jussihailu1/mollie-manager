import { loadEnvConfig } from "@next/env";
import { parseReceiptConfiguration } from "../lib/eboekhouden/payment-receipt-configuration";

async function main() {
  const command = parseReceiptConfiguration(process.argv.slice(2));
  loadEnvConfig(process.cwd());
  const { configureTenantReceiptAutomation } = await import("../lib/eboekhouden/payment-receipt-settings");
  const { getDbPool } = await import("../lib/db");
  try {
    const result = await configureTenantReceiptAutomation(command);
    console.log(JSON.stringify({ ...result, financialEntriesCreated: 0,
      globalRuntimeEnabled: process.env.EBOEKHOUDEN_RECEIPT_AUTOMATION_ENABLED === "true" }, null, 2));
  } finally { await getDbPool().end(); }
}
void main().catch(() => {
  console.error("Receipt configuration failed. Check the explicit tenant/profile/FIN account, future cutoff, migration and existing receipt mappings. No financial entries are created by this command.");
  process.exitCode = 1;
});
