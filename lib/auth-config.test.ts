import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("auth config", () => {
  it("fails closed when AUTH_SECRET is missing", () => {
    const source = readFileSync(resolve("auth.ts"), "utf8");

    assert.match(source, /throw new Error\("AUTH_SECRET is missing\."\)/);
    assert.doesNotMatch(
      source,
      /setup-required-auth-secret-change-me-00000000/,
    );
  });
});
