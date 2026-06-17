import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("advanced operations access", () => {
  it("uses an explicit advanced email allowlist for developer operations", () => {
    const envSource = readFileSync(resolve("lib/env.ts"), "utf8");
    const permissionsSource = readFileSync(
      resolve("lib/auth/permissions.ts"),
      "utf8",
    );
    const authSource = readFileSync(resolve("auth.ts"), "utf8");
    const typeSource = readFileSync(resolve("types/next-auth.d.ts"), "utf8");

    assert.match(envSource, /AUTH_ADVANCED_EMAILS: optionalString/);
    assert.match(permissionsSource, /parseEmailAllowlist/);
    assert.match(permissionsSource, /isAdvancedOperationsEmail/);
    assert.match(authSource, /roleForEmail/);
    assert.match(typeSource, /AppUserRole/);
  });
});
