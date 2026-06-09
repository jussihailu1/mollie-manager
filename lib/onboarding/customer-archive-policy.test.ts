import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  resolveCustomerArchiveBlocker,
  resolveCustomerRestoreBlocker,
} from "@/lib/onboarding/customer-archive-policy";

describe("customer archive policy", () => {
  it("notices when customer is already archived", () => {
    assert.deepEqual(
      resolveCustomerArchiveBlocker({
        archivedAt: "2026-06-09T10:00:00.000Z",
        subscriptions: [{ localStatus: "active" }],
      }),
      {
        kind: "notice",
        message: "Customer is already archived.",
      },
    );
  });

  it("blocks archive when billing can still progress", () => {
    assert.deepEqual(
      resolveCustomerArchiveBlocker({
        archivedAt: null,
        subscriptions: [{ localStatus: "mandate_pending" }],
      }),
      {
        kind: "error",
        message: "Cancel or stop active billing before archiving this customer.",
      },
    );
  });

  it("allows archive when subscriptions are terminal or absent", () => {
    assert.equal(
      resolveCustomerArchiveBlocker({
        archivedAt: null,
        subscriptions: [{ localStatus: "future_charges_stopped" }],
      }),
      null,
    );
    assert.equal(
      resolveCustomerArchiveBlocker({
        archivedAt: null,
        subscriptions: [],
      }),
      null,
    );
  });

  it("notices when restoring an already active customer", () => {
    assert.deepEqual(resolveCustomerRestoreBlocker(null), {
      kind: "notice",
      message: "Customer is already active.",
    });
    assert.equal(resolveCustomerRestoreBlocker("2026-06-09T10:00:00.000Z"), null);
  });
});
