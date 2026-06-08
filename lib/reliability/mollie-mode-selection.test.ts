import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildConfiguredMollieModeOrder,
  type MollieModeAvailability,
} from "@/lib/reliability/mollie-mode-selection";

describe("mollie mode selection", () => {
  const configured =
    (modes: Array<"live" | "test">): MollieModeAvailability =>
    (mode) =>
      modes.includes(mode);

  it("uses preferred mode first and falls back to other configured mode", () => {
    assert.deepEqual(
      buildConfiguredMollieModeOrder({
        isConfigured: configured(["live", "test"]),
        preferredMode: "test",
      }),
      ["test", "live"],
    );
  });

  it("defaults to live then test when no preferred mode exists", () => {
    assert.deepEqual(
      buildConfiguredMollieModeOrder({
        isConfigured: configured(["live", "test"]),
      }),
      ["live", "test"],
    );
  });

  it("filters unconfigured modes", () => {
    assert.deepEqual(
      buildConfiguredMollieModeOrder({
        isConfigured: configured(["test"]),
        preferredMode: "live",
      }),
      ["test"],
    );
  });

  it("does not fall back when strict mode is requested", () => {
    assert.deepEqual(
      buildConfiguredMollieModeOrder({
        isConfigured: configured(["test"]),
        preferredMode: "live",
        strictMode: true,
      }),
      [],
    );
  });
});
