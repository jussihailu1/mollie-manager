import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildActionPath,
  updateActionPath,
} from "@/lib/onboarding/action-path";

describe("onboarding action path helpers", () => {
  it("builds a path from params only when params are present", () => {
    assert.equal(buildActionPath("/customers"), "/customers");
    assert.equal(
      buildActionPath("/customers", new URLSearchParams({ view: "setup" })),
      "/customers?view=setup",
    );
  });

  it("updates, preserves, and removes query params", () => {
    assert.equal(
      updateActionPath("/customers?page=2&view=all", {
        error: "Needs sync",
        view: "setup",
        notice: null,
      }),
      "/customers?page=2&view=setup&error=Needs+sync",
    );

    assert.equal(
      updateActionPath("/customers?page=2&error=old", {
        error: "",
      }),
      "/customers?page=2",
    );
  });
});
