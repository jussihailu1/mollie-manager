import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("login access flow", () => {
  it("keeps Google sign-in separate from membership-led product access", () => {
    const loginPageSource = readFileSync(resolve("app/login/page.tsx"), "utf8");
    const loginFormSource = readFileSync(
      resolve("components/login-form.tsx"),
      "utf8",
    );

    assert.match(loginPageSource, /getTenantAccessForOperatorEmail/);
    assert.match(
      loginPageSource,
      /This Google account is signed in, but it does not have tenant or platform access yet\./,
    );
    assert.match(loginPageSource, /signedInEmail=\{/);
    assert.ok(loginPageSource.includes("session?.user?.email ?? null"));
    assert.match(loginFormSource, /tenant member or platform operator account/);
    assert.match(loginFormSource, /signOutUser/);
    assert.match(loginFormSource, /Sign out and try another account/);
  });
});
