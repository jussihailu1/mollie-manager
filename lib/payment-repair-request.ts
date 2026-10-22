import { REPAIR_RETRY_AFTER_MS } from "./freshness";

type RepairResult = { status?: string } | null;

export function createPaymentRepairRunner({
  storage,
  request,
  now = Date.now,
}: {
  storage: () => Pick<Storage, "getItem" | "setItem">;
  request: typeof fetch;
  now?: () => number;
}) {
  const inFlight = new Map<string, Promise<RepairResult>>();
  return function repair(paymentId: string, fingerprint: string): Promise<RepairResult> {
    const pending = inFlight.get(paymentId);
    if (pending) return pending;
    const storageKey = `repair:payment:${paymentId}:${fingerprint}`;
    // Fail closed if browser storage is unavailable: do not bypass the throttle.
    let lastAttempt: number;
    try {
      lastAttempt = Number(storage().getItem(storageKey) ?? "0");
      if (Number.isFinite(lastAttempt) && now() - lastAttempt < REPAIR_RETRY_AFTER_MS) {
        return Promise.resolve(null);
      }
      storage().setItem(storageKey, String(now()));
    } catch {
      return Promise.reject(new Error("Automatic repair requires browser storage. Please reload when storage is available."));
    }
    const attempt = (async () => {
      const response = await request("/api/reliability/repair", {
        body: JSON.stringify({ id: paymentId, kind: "payment" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(typeof body?.error === "string" ? body.error : "Failed to repair payment state.");
      }
      return body as RepairResult;
    })().finally(() => { inFlight.delete(paymentId); });
    inFlight.set(paymentId, attempt);
    return attempt;
  };
}

// Keep an already submitted POST alive across drawer close/reopen and Strict Mode.
// GET cancellation must not cause a second financial repair request.
export const repairPayment = createPaymentRepairRunner({
  storage: () => window.localStorage,
  request: (...args) => fetch(...args),
});
