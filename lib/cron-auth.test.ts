import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getAcceptedCronSecrets, isBearerAuthorized } from "@/lib/cron-auth";

describe("cron auth helpers", () => {
  it("builds unique secret list and drops empty values", () => {
    const secrets = getAcceptedCronSecrets({
      cronSecret: "secret-a",
      invoiceCronSharedSecret: "secret-a",
    });

    assert.deepEqual(secrets, ["secret-a"]);
  });

  it("accepts either configured bearer secret", () => {
    const secrets = getAcceptedCronSecrets({
      cronSecret: "secret-a",
      invoiceCronSharedSecret: "secret-b",
    });

    assert.equal(isBearerAuthorized("Bearer secret-a", secrets), true);
    assert.equal(isBearerAuthorized("Bearer secret-b", secrets), true);
    assert.equal(isBearerAuthorized("Bearer wrong", secrets), false);
  });

  it("rejects missing auth header or missing secrets", () => {
    assert.equal(isBearerAuthorized(null, ["secret-a"]), false);
    assert.equal(isBearerAuthorized("Bearer secret-a", []), false);
  });
});
