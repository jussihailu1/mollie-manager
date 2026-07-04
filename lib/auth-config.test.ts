import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("auth config", () => {
  it("fails closed on AUTH_SECRET and no longer gates sign-in on AUTH_ALLOWED_EMAIL", () => {
    const authSource = readFileSync(resolve("auth.ts"), "utf8");
    const envSource = readFileSync(resolve("lib/env.ts"), "utf8");

    assert.match(authSource, /throw new Error\("AUTH_SECRET is missing\."\)/);
    assert.doesNotMatch(authSource, /AUTH_ALLOWED_EMAIL|allowedEmail/);
    assert.doesNotMatch(envSource, /AUTH_ALLOWED_EMAIL is missing\./);
    assert.match(envSource, /AUTH_GOOGLE_ID is missing\./);
    assert.match(envSource, /AUTH_GOOGLE_SECRET is missing\./);
    assert.match(envSource, /AUTH_SECRET is missing\./);
    assert.doesNotMatch(authSource, /setup-required-auth-secret-change-me-00000000/);
  });
});
