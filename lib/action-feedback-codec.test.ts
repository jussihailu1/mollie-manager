import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  decodeActionFeedback,
  encodeActionFeedback,
} from "@/lib/action-feedback-codec";

const secret = "test-action-feedback-secret";
const feedback = {
  expiresAt: Date.now() + 60_000,
  kind: "information" as const,
  message: "Background sync is still running.",
  recipientEmail: "operator@example.com",
};

describe("action feedback codec", () => {
  it("round-trips each supported feedback kind", () => {
    for (const kind of ["success", "error", "information"] as const) {
      const encoded = encodeActionFeedback({ ...feedback, kind }, secret);
      assert.deepEqual(decodeActionFeedback(encoded, secret, 180), { ...feedback, kind });
    }
  });

  it("rejects a tampered or oversized payload", () => {
    const encoded = encodeActionFeedback(feedback, secret);
    assert.equal(decodeActionFeedback(`${encoded}tampered`, secret, 180), null);
    assert.equal(
      decodeActionFeedback(
        encodeActionFeedback({ ...feedback, message: "x".repeat(181) }, secret),
        secret,
        180,
      ),
      null,
    );
  });
});
