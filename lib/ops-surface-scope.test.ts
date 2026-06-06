import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("ops surface hardening", () => {
  it("limits webhook replay to failed events in current mode", () => {
    const source = readFileSync(resolve("lib/reliability/actions.ts"), "utf8");

    assert.match(source, /processing_status as "processingStatus"/);
    assert.match(
      source,
      /Only failed webhook events in the current mode can be replayed\./,
    );
    assert.match(source, /event\.processingStatus !== "failed"/);
  });

  it("surfaces first-class operator diagnostics and replay controls in settings", () => {
    const source = readFileSync(resolve("app/(dashboard)/settings/page.tsx"), "utf8");

    assert.match(source, /Operations overview/);
    assert.match(source, /Open JSON diagnostics/);
    assert.match(source, /Failed webhook replay queue/);
    assert.match(source, /replayWebhookEventAction/);
  });
});
