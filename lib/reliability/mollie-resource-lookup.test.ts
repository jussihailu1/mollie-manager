import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { findMollieResourceAcrossModes } from "@/lib/reliability/mollie-resource-lookup";

describe("mollie resource lookup", () => {
  it("returns the first successful resource with its mode", async () => {
    const attempts: string[] = [];

    const result = await findMollieResourceAcrossModes(
      ["live", "test"],
      async (mode) => {
        attempts.push(mode);

        if (mode === "live") {
          throw new Error("not in live");
        }

        return { id: "tr_test" };
      },
      "Payment was not found in Mollie.",
    );

    assert.deepEqual(attempts, ["live", "test"]);
    assert.deepEqual(result, {
      mode: "test",
      resource: { id: "tr_test" },
    });
  });

  it("throws the last lookup error when all configured modes fail", async () => {
    await assert.rejects(
      () =>
        findMollieResourceAcrossModes(
          ["live", "test"],
          async (mode) => {
            throw new Error(`not in ${mode}`);
          },
          "Payment was not found in Mollie.",
        ),
      /not in test/,
    );
  });

  it("throws the not-found message when no modes are available", async () => {
    await assert.rejects(
      () =>
        findMollieResourceAcrossModes(
          [],
          async () => ({ id: "unused" }),
          "Payment was not found in Mollie.",
        ),
      /Payment was not found in Mollie/,
    );
  });
});
