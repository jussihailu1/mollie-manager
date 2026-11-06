import assert from "node:assert/strict";
import { it } from "node:test";
import { findOrCreateActivationSubscription } from "./subscription-activation-provider";

const subscription = { id: "sub_1", customerId: "cst_1", mode: "live", status: "active", metadata: { consentId: "consent-1" } };
function harness(items: typeof subscription[], failAfterList = false) {
  let creates = 0;
  return {
    creates: () => creates,
    run: () => findOrCreateActivationSubscription({ consentId: "consent-1", customerId: "cst_1", mode: "live", request: { frozen: true },
      list: async function* () { for (const item of items) yield item; if (failAfterList) throw new Error("provider unavailable"); },
      create: async () => { creates++; return subscription; },
    }),
  };
}
it("creates once when every provider page confirms no existing subscription", async () => {
  const h = harness([]); assert.equal((await h.run()).id, "sub_1"); assert.equal(h.creates(), 1);
});
it("adopts a subscription after a lost response/local save, including legacy requests", async () => {
  const h = harness([subscription]); await h.run(); await h.run(); assert.equal(h.creates(), 0);
});
for (const [label, items, fail] of [
  ["duplicate consent", [subscription, subscription], false],
  ["wrong customer", [{ ...subscription, customerId: "other" }], false],
  ["wrong mode", [{ ...subscription, mode: "test" }], false],
  ["cancelled subscription", [{ ...subscription, status: "canceled" }], false],
  ["other active consent", [{ ...subscription, metadata: { consentId: "other" } }], false],
  ["incomplete pagination", [subscription], true],
] as const) {
  it(`never creates on ${label}`, async () => {
    const h = harness([...items], fail); await assert.rejects(h.run()); assert.equal(h.creates(), 0);
  });
}
