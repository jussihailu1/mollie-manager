import assert from "node:assert/strict";
import { it } from "node:test";
import { createAsyncResource } from "./async-resource";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

it("disabled resources stay idle and snapshots stay referentially stable", () => {
  const resource = createAsyncResource(null);
  assert.equal(resource.start(), undefined);
  assert.deepEqual(resource.getSnapshot(), { data: null, error: null, loading: false });
  assert.equal(resource.getSnapshot(), resource.getSnapshot());
});

it("customer switches expose loading without old data, and abort obsolete reads", async () => {
  const first = deferred<string>();
  const second = deferred<string>();
  let signal!: AbortSignal;
  const oldResource = createAsyncResource((s) => { signal = s; return first.promise; });
  const newResource = createAsyncResource(() => second.promise);
  const stop = oldResource.start()!;
  let notifications = 0;
  const unsubscribe = oldResource.subscribe(() => { notifications++; });
  stop();
  assert.equal(signal.aborted, true);
  newResource.start();
  assert.deepEqual(newResource.getSnapshot(), { data: null, error: null, loading: true });
  second.resolve("customer B");
  await second.promise;
  first.resolve("customer A");
  await first.promise;
  assert.equal(newResource.getSnapshot().data, "customer B");
  assert.equal(oldResource.getSnapshot().data, null);
  assert.equal(notifications, 0);
  unsubscribe();
});

it("Strict Mode restart ignores late failure from the abandoned request", async () => {
  const first = deferred<string>();
  const second = deferred<string>();
  let calls = 0;
  const resource = createAsyncResource(() => ++calls === 1 ? first.promise : second.promise);
  resource.start()!();
  resource.start();
  second.resolve("current");
  await second.promise;
  first.reject(new Error("obsolete"));
  await first.promise.catch(() => {});
  assert.deepEqual(resource.getSnapshot(), { data: "current", error: null, loading: false });
});

it("failed reads end loading and expose a retryable error instead of stale data", async () => {
  const request = deferred<string>();
  const resource = createAsyncResource(() => request.promise);
  resource.start();
  request.reject(new Error("Unavailable"));
  await request.promise.catch(() => {});
  assert.deepEqual(resource.getSnapshot(), { data: null, error: "Unavailable", loading: false });
});

it("keeps loaded data visible during refresh and replaces it when the request completes", async () => {
  const next = deferred<string>();
  let calls = 0;
  const resource = createAsyncResource(() => ++calls === 1 ? Promise.resolve("previous") : next.promise);
  const stop = resource.start()!;
  await Promise.resolve();
  stop();
  resource.start();
  assert.deepEqual(resource.getSnapshot(), { data: "previous", error: null, loading: true });
  next.resolve("updated");
  await next.promise;
  assert.deepEqual(resource.getSnapshot(), { data: "updated", error: null, loading: false });
});

it("retains loaded data on a background failure and clears the error on retry", async () => {
  let fail = false;
  const resource = createAsyncResource(async () => {
    if (fail) throw new Error("Offline");
    return "loaded";
  });
  resource.start();
  await Promise.resolve();
  fail = true;
  resource.start();
  await Promise.resolve();
  assert.deepEqual(resource.getSnapshot(), { data: "loaded", error: "Offline", loading: false });
  fail = false;
  resource.start();
  await Promise.resolve();
  assert.deepEqual(resource.getSnapshot(), { data: "loaded", error: null, loading: false });
});
