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
      buildActionPath("/customers", new URLSearchParams({ focus: "cus_1" })),
      "/customers?focus=cus_1",
    );
  });

  it("updates, preserves, and removes query params", () => {
    assert.equal(
      updateActionPath("/customers?page=2&focus=old", {
        error: "Needs sync",
        focus: "new",
        notice: null,
      }),
      "/customers?page=2&focus=new&error=Needs+sync",
    );

    assert.equal(
      updateActionPath("/customers?page=2&error=old", {
        error: "",
      }),
      "/customers?page=2",
    );
  });
});
