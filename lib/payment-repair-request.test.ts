import assert from "node:assert/strict";
import { it } from "node:test";
import { createPaymentRepairRunner } from "./payment-repair-request";
import { REPAIR_RETRY_AFTER_MS } from "./freshness";

function memoryStorage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}

it("deduplicates in-flight repair across remounts and fingerprint changes", async () => {
  let finish!: (response: Response) => void;
  let calls = 0;
  const storage = memoryStorage();
  const repair = createPaymentRepairRunner({ storage: () => storage, request: async (url, init) => {
    calls++;
    assert.equal(url, "/api/reliability/repair");
    assert.equal(init?.method, "POST");
    assert.deepEqual(JSON.parse(init?.body as string), { id: "payment-A", kind: "payment" });
    return new Promise<Response>((resolve) => { finish = resolve; });
  } });
  const first = repair("payment-A", "never:unknown");
  assert.equal(repair("payment-A", "never:unknown"), first);
  assert.equal(repair("payment-A", "never:invoice_failed"), first);
  assert.equal(calls, 1);
  finish(Response.json({ status: "repaired" }));
  assert.deepEqual(await first, { status: "repaired" });
  assert.equal(await repair("payment-A", "never:unknown"), null);
  assert.equal(calls, 1);
});

it("preserves persisted throttling, allows retry after expiry, and scopes by payment", async () => {
  let now = 1_000_000;
  let calls = 0;
  const storage = memoryStorage();
  storage.setItem("repair:payment:A:version", String(now));
  const repair = createPaymentRepairRunner({ storage: () => storage, now: () => now, request: async () => {
    calls++;
    return Response.json({ status: "unchanged" });
  } });
  assert.equal(await repair("A", "version"), null);
  await repair("B", "version");
  assert.equal(calls, 1);
  now += REPAIR_RETRY_AFTER_MS;
  await repair("A", "version");
  assert.equal(calls, 2);
});

it("failed repairs are throttled too; storage failures cannot bypass the limit", async () => {
  const storage = memoryStorage();
  let calls = 0;
  const request: typeof fetch = async () => { calls++; return Response.json({ error: "Repair unavailable" }, { status: 503 }); };
  const repair = createPaymentRepairRunner({ storage: () => storage, request });
  await assert.rejects(repair("A", "version"), /Repair unavailable/);
  assert.equal(await repair("A", "version"), null);
  const blocked = createPaymentRepairRunner({ storage: () => { throw Error("blocked"); }, request });
  await assert.rejects(blocked("B", "version"), /requires browser storage/);
  assert.equal(calls, 1);
});
