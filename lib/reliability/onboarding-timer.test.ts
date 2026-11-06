import assert from "node:assert/strict";
import { it } from "node:test";
import { runRecovery } from "../../operations/onboarding-recovery-worker/index.mjs";

it("calls only the protected onboarding endpoint and records its scheduled source", async () => {
  const runId = await runRecovery({ RECOVERY_SECRET: "test-secret" }, async (url, options) => {
    assert.equal(url, "https://kify.app/api/cron/onboarding");
    assert.equal(options?.method, "POST");
    assert.equal(options?.redirect, "manual");
    const headers = new Headers(options?.headers);
    assert.equal(headers.get("authorization"), "Bearer test-secret");
    assert.equal(headers.get("x-kify-recovery-trigger"), "schedule");
    assert.equal(headers.get("x-kify-recovery-scheduler"), "cloudflare");
    assert.ok(options?.signal);
    return Response.json({ status: "ok", runId: "run-1" });
  });
  assert.equal(runId, "run-1");
});
it("never calls the app without a credential", async () => {
  await assert.rejects(runRecovery({}, async () => { throw new Error("must not fetch"); }), /credential is missing/);
});
for (const status of [302, 307, 401, 503]) it(`fails the cron on HTTP ${status} without exposing the response body`, async () => {
  await assert.rejects(runRecovery({ RECOVERY_SECRET: "test-secret" }, async () => new Response("private detail", { status })), new RegExp(`HTTP ${status}$`));
});
it("rejects an incomplete recovery even with HTTP 200", async () => {
  await assert.rejects(runRecovery({ RECOVERY_SECRET: "test-secret" }, async () => Response.json({ status: "partial", runId: "run-1" })), /did not complete/);
});
