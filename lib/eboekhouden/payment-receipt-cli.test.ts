import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("receipt configuration loads in its real server CLI without request/session runtime", () => {
  const environment = { ...process.env };
  for (const name of Object.keys(environment)) {
    if (/^(DATABASE_|MOLLIE_|EBOEKHOUDEN_|SMTP_|AUTH_|APP_ENCRYPTION_KEY)/.test(name)) delete environment[name];
  }
  environment.AUTH_SECRET = "receipt-cli-import-test-only-secret";
  const result = spawnSync(process.execPath, [
    "--conditions=react-server", "--import", "tsx", "--input-type=module", "--eval",
    `globalThis.fetch = () => { throw new Error("Unexpected provider call during import"); };
     const settings = await import("./lib/eboekhouden/payment-receipt-settings.ts");
     const configure = settings.configureTenantReceiptAutomation ?? settings.default?.configureTenantReceiptAutomation;
     if (typeof configure !== "function") throw new Error("Configuration entry point missing");
     console.log("receipt-cli-ready");`,
  ], { cwd: process.cwd(), env: environment, encoding: "utf8", timeout: 20000 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /receipt-cli-ready/);
});
