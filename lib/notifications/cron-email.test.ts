import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

import { sendNotificationEmailWithTransport } from "./email-core";

// Exercise the real SMTP wrapper with an inert transport; never load env/SMTP.
function loadSender(dependencies: Record<string, unknown>) {
  const path = "lib/notifications/email.ts";
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
  const declaration = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "sendOperatorEmailOnce");
  assert.ok(declaration);
  const exports: { sendOperatorEmailOnce?: (message: { subject: string; text: string }) => Promise<void> } = {};
  runInNewContext(ts.transpileModule(declaration.getText(source), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, ...dependencies });
  assert.ok(exports.sendOperatorEmailOnce);
  return exports.sendOperatorEmailOnce;
}

for (const failure of [false, true]) {
  it(`uses ALERT_EMAIL_TO once and closes its bounded transport (${failure ? "timeout" : "success"})`, async () => {
    const messages: { to: string; from: string }[] = [];
    let closed = 0;
    const send = loadSender({
      getNotificationConfig: () => ({ SMTP_FROM: "system@example.test", ALERT_EMAIL_TO: "operator@example.test", INVOICE_EMAIL_OVERRIDE_TO: "override@example.test", SMTP_PORT: 465 }),
      sendNotificationEmailWithTransport,
      nodemailer: { createTransport: (options: Record<string, unknown>) => {
        assert.equal(options.connectionTimeout, 5000);
        assert.equal(options.greetingTimeout, 5000);
        assert.equal(options.socketTimeout, 10000);
        assert.equal(options.dnsTimeout, 5000);
        assert.equal(options.secure, true);
        return {
          sendMail: async (message: (typeof messages)[number]) => {
            messages.push(message);
            if (failure) throw new Error("ETIMEDOUT after possible SMTP acceptance");
          },
          close: () => { closed++; },
        };
      } },
    });
    const attempt = send({ subject: "Cron test", text: "No billing invoked" });
    if (failure) await assert.rejects(attempt, /ETIMEDOUT/);
    else await attempt;
    assert.equal(messages.length, 1);
    assert.equal(messages[0].to, "operator@example.test");
    assert.equal(messages[0].from, "system@example.test");
    assert.equal(closed, 1);
  });
}
