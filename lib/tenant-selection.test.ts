import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getTenantSelectionCookieOptions,
  resolveTenantSelectionId,
} from "@/lib/tenant-selection";

describe("tenant selection helper", () => {
  it("prefers a valid requested tenant and otherwise falls back to the first accessible tenant", () => {
    assert.equal(
      resolveTenantSelectionId({
        accessibleTenantIds: ["tenant-b", "tenant-a"],
        preferredTenantId: "tenant-a",
      }),
      "tenant-a",
    );

    assert.equal(
      resolveTenantSelectionId({
        accessibleTenantIds: ["tenant-b", "tenant-a"],
        preferredTenantId: "missing",
      }),
      "tenant-b",
    );

    assert.equal(
      resolveTenantSelectionId({
        accessibleTenantIds: [],
        preferredTenantId: "missing",
      }),
      null,
    );
  });

  it("uses strict cookie settings for tenant selection", () => {
    assert.deepEqual(getTenantSelectionCookieOptions(false), {
      httpOnly: true,
      maxAge: 31_536_000,
      path: "/",
      sameSite: "lax",
      secure: false,
    });

    assert.deepEqual(getTenantSelectionCookieOptions(true), {
      httpOnly: true,
      maxAge: 31_536_000,
      path: "/",
      sameSite: "lax",
      secure: true,
    });
  });
});
