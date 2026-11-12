import assert from "node:assert/strict";
import test from "node:test";
import { ZodError } from "zod";
import { loadIsolated } from "../testing/isolated-module";
import * as posting from "./invoice-posting";
import * as pagination from "./pagination";
import type { ReceiptMutationInput } from "./payment-receipt-preview";

const payload: ReceiptMutationInput = { type: 3, date: "2026-06-11", ledgerId: 3, invoiceNumber: "F00037", relationId: 20,
  inExVat: "IN", description: "Mollie tr_fixture", entryNumber: "KIFY-PAY-tr_fixture", paymentReference: "KIFY-PAY-tr_fixture",
  checkPaymentReference: true, rows: [{ amount: 19.99, vatCode: "GEEN", invoiceNumber: "F00037", relationId: 20, description: "Mollie tr_fixture" }] };

function transport(options: {
  session?: () => Response | Promise<Response>;
  mutation?: (init: RequestInit) => Response | Promise<Response>;
  read?: (url: URL) => Response;
} = {}) {
  const requests: { url: URL; init: RequestInit }[] = [];
  const credentials: string[] = [];
  const events: string[] = [];
  class TenantCredentialError extends Error {}
  const client = loadIsolated<typeof import("./client")>("lib/eboekhouden/client.ts", {
    "server-only": {}, zod: { ZodError },
    "@/lib/eboekhouden/tenant-credentials": {
      TenantEboekhoudenCredentialError: TenantCredentialError,
      resolveTenantEboekhoudenConfig: async (tenantId: string) => {
        credentials.push(tenantId); assert.equal(tenantId, "tenant-fixture");
        return { EBOEKHOUDEN_API_TOKEN: "fixture-secret", EBOEKHOUDEN_API_SOURCE: "Fixture" };
      },
    },
    "@/lib/eboekhouden/invoice-posting": posting,
    "@/lib/eboekhouden/pagination": pagination,
    "@/lib/eboekhouden/invoice-flow-helpers": { InvoicePreflightError: class extends Error {} },
  }, {
    AbortSignal,
    fetch: async (address: string, init: RequestInit) => {
      const url = new URL(address); requests.push({ url, init });
      assert.equal(url.origin, "https://api.e-boekhouden.nl");
      if (url.pathname === "/v1/session") {
        events.push("session"); assert.equal(init.method, "POST");
        assert.deepEqual(JSON.parse(String(init.body)), { accessToken: "fixture-secret", source: "Fixture" });
        return options.session ? options.session() : Response.json({ token: "fixture-session", expiresIn: 3600 });
      }
      if (init.method === "POST") {
        events.push("financial-post"); assert.equal(url.pathname, "/v1/mutation");
        assert.equal(init.redirect, "error"); assert.ok(init.signal instanceof AbortSignal);
        assert.equal(new Headers(init.headers).get("Authorization"), "fixture-session");
        assert.deepEqual(JSON.parse(String(init.body)), payload);
        return options.mutation ? options.mutation(init) : Response.json({ id: 500 });
      }
      return options.read ? options.read(url) : Response.json({ items: [] });
    },
  });
  return { client, requests, credentials, events, posts: () => requests.filter(r => r.init.method === "POST" && r.url.pathname === "/v1/mutation") };
}

test("authenticates the explicit tenant, then durably marks, then makes exactly one receipt POST", async () => {
  const f = transport();
  assert.deepEqual(await f.client.createEboekhoudenPaymentReceipt(payload, "tenant-fixture", async () => { f.events.push("durable-marker"); }), { id: 500 });
  assert.deepEqual(f.events, ["session", "durable-marker", "financial-post"]); assert.equal(f.posts().length, 1);
  assert.deepEqual(f.credentials, ["tenant-fixture"]);
});

test("awaits the durable marker before starting the financial fetch", async () => {
  const f = transport(); let enter!: () => void; let release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const pending = f.client.createEboekhoudenPaymentReceipt(payload, "tenant-fixture", async () => { enter(); await gate; });
  await entered; assert.equal(f.posts().length, 0); release(); await pending; assert.equal(f.posts().length, 1);
});

test("a rejected durable marker prevents any financial request", async () => {
  const f = transport();
  await assert.rejects(() => f.client.createEboekhoudenPaymentReceipt(payload, "tenant-fixture", async () => { throw new Error("Lease lost"); }), /Lease lost/);
  assert.equal(f.posts().length, 0); assert.deepEqual(f.events, ["session"]);
});

test("financial 401, 429, 500, redirect, network and invalid JSON outcomes are never retried", async () => {
  for (const outcome of ["401", "429", "500", "redirect", "network", "json"] as const) {
    const f = transport({ mutation: () => {
      if (outcome === "network") throw new TypeError("Connection lost after request transmission");
      if (outcome === "json") return new Response("{", { status: 200, headers: { "Content-Type": "application/json" } });
      if (outcome === "redirect") return new Response(null, { status: 302, headers: { Location: "https://another.example/" } });
      return Response.json({ code: "TEST_REJECTION", title: "Fixture error" }, { status: Number(outcome) });
    } });
    let markers = 0;
    await assert.rejects(() => f.client.createEboekhoudenPaymentReceipt(payload, "tenant-fixture", async () => { markers++; }));
    assert.equal(markers, 1, outcome); assert.equal(f.posts().length, 1, outcome); assert.equal(f.credentials.length, 1, outcome);
    assert.equal(f.requests.length, 2, outcome);
  }
});

test("session rejection, network failure or malformed JSON stops before marking and before any financial POST", async () => {
  for (const outcome of ["reject", "network", "json"] as const) {
    const f = transport({ session: () => {
      if (outcome === "network") throw new TypeError("Session unavailable");
      if (outcome === "json") return new Response("{", { status: 200 });
      return Response.json({ code: "API_SESSION_001", message: "Fixture failure" }, { status: 403 });
    } });
    let markers = 0;
    await assert.rejects(() => f.client.createEboekhoudenPaymentReceipt(payload, "tenant-fixture", async () => { markers++; }));
    assert.equal(markers, 0); assert.equal(f.posts().length, 0); assert.equal(f.requests.length, 1);
  }
});

test("malformed successful session data cannot mark or submit a financial request", async () => {
  for (const session of [{ expiresIn: 3600 }, { token: "", expiresIn: 3600 }, { token: "fixture-session", expiresIn: 0 },
    { token: "fixture-session", expiresIn: "invalid" }]) {
    const f = transport({ session: () => Response.json(session) }); let markers = 0;
    await assert.rejects(() => f.client.createEboekhoudenPaymentReceipt(payload, "tenant-fixture", async () => { markers++; }));
    assert.equal(markers, 0); assert.equal(f.posts().length, 0);
  }
});

test("receipt writes authenticate freshly even when a tenant read session is already cached", async () => {
  const f = transport();
  await f.client.getEboekhoudenMutation(337, "tenant-fixture");
  await f.client.createEboekhoudenPaymentReceipt(payload, "tenant-fixture", async () => {});
  assert.equal(f.requests.filter(r => r.url.pathname === "/v1/session").length, 2);
  assert.deepEqual(f.credentials, ["tenant-fixture", "tenant-fixture"]); assert.equal(f.posts().length, 1);
});

test("missing tenant, wrong mutation kind and missing uniqueness check fail before authentication", async () => {
  for (const [input, tenant] of [[payload, ""], [{ ...payload, type: 2 }, "tenant-fixture"],
    [{ ...payload, checkPaymentReference: false }, "tenant-fixture"]] as const) {
    const f = transport();
    await assert.rejects(() => f.client.createEboekhoudenPaymentReceipt(input as ReceiptMutationInput, tenant, async () => { assert.fail("No marker expected"); }));
    assert.equal(f.requests.length, 0); assert.equal(f.credentials.length, 0);
  }
});

test("mutation and outstanding reads encode bounded filters and preserve the explicit tenant", async () => {
  const f = transport({ read: url => Response.json(url.pathname.endsWith("outstanding")
    ? { items: [{ mutationId: 337, invoiceNumber: "F/37&", outstandingAmount: 19.99 }], count: 1 } : { items: [{ id: 337 }], count: 1 }) });
  await f.client.listEboekhoudenMutations({ tenantId: "tenant-fixture", limit: 100, offset: 200,
    invoiceNumber: "F/37&", description: "%tr_fixture%", date: "2026-06-11" });
  const mutation = f.requests.at(-1)!.url;
  assert.equal(mutation.searchParams.get("invoiceNumber"), "F/37&"); assert.equal(mutation.searchParams.get("description[like]"), "%tr_fixture%");
  assert.equal(mutation.searchParams.get("date"), "2026-06-11"); assert.equal(mutation.searchParams.get("offset"), "200");
  const outstanding = await f.client.listEboekhoudenOutstanding({ tenantId: "tenant-fixture", invoiceNumber: "F/37&", limit: 100, offset: 0 });
  assert.equal(f.requests.at(-1)!.url.searchParams.get("credDeb"), "D"); assert.equal(outstanding.items?.[0].id, 337);
  assert.equal(f.posts().length, 0); assert.deepEqual(f.credentials, ["tenant-fixture"]);
});
