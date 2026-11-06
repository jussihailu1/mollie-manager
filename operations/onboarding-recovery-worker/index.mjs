/** @param {{ RECOVERY_SECRET?: string }} env @param {typeof fetch} transport */
export async function runRecovery(env, transport = fetch) {
  if (!env.RECOVERY_SECRET) throw new Error("Onboarding recovery credential is missing");
  const response = await transport("https://kify.app/api/cron/onboarding", {
    method: "POST",
    // Workers supports manual/follow, not Node's error mode. Manual prevents
    // forwarding the credential; the non-2xx check below rejects redirects.
    redirect: "manual",
    headers: {
      Authorization: `Bearer ${env.RECOVERY_SECRET}`,
      "X-Kify-Recovery-Trigger": "schedule",
      "X-Kify-Recovery-Scheduler": "cloudflare",
    },
    signal: AbortSignal.timeout(75_000),
  });
  if (!response.ok) throw new Error(`Onboarding recovery HTTP ${response.status}`);
  const result = await response.json();
  if (result.status !== "ok" || typeof result.runId !== "string") throw new Error("Onboarding recovery did not complete");
  return result.runId;
}

const worker = {
  /** @param {{ scheduledTime: number }} controller @param {{ RECOVERY_SECRET?: string }} env */
  async scheduled(controller, env) {
    // Await completion; never turn a failed/partial request into a successful cron.
    const runId = await runRecovery(env);
    console.log(JSON.stringify({ event: "onboarding_recovery_completed", scheduledTime: controller.scheduledTime, runId }));
  },
};

export default worker;
