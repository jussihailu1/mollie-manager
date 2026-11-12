import assert from "node:assert/strict";
import test from "node:test";
import { configureReceiptAutomation, parseReceiptConfiguration, type ReceiptConfigurationCommand } from "./payment-receipt-configuration";
import type { ReceiptSettings } from "./payment-receipt-contract";

const argumentsForEnable = ["--tenant-id", "tenant", "--enable", "--profile-id", "pfl_fixture", "--clearing-ledger-id", "3",
  "--payments-from", "2099-06-10T23:00:00+02:00"];
function fixture() {
  const state = { current: null as ReceiptSettings | null, saves: [] as ReceiptSettings[], disabled: [] as string[], verifies: 0, reads: 0,
    providerProfile: "pfl_fixture", financialLedgerIds: [3], credentialVersion: "2026-11-01T12:00:00Z" };
  const dependencies = {
    now: () => Date.parse("2026-11-11T12:00:00Z"),
    current: async (tenantId: string) => { assert.equal(tenantId, "tenant"); state.reads++; return state.current; },
    verify: async (tenantId: string) => { assert.equal(tenantId, "tenant"); state.verifies++; return {
      profileId: state.providerProfile, financialLedgerIds: state.financialLedgerIds, credentialVersion: state.credentialVersion,
    }; },
    save: async (settings: ReceiptSettings) => { state.saves.push(settings); },
    disable: async (tenantId: string) => { state.disabled.push(tenantId); },
  };
  return { state, dependencies, command: parseReceiptConfiguration(argumentsForEnable) };
}

test("receipt setup defaults to preview, normalizes timezone and requires explicit apply", async () => {
  const f = fixture(); assert.deepEqual(f.command, { tenantId: "tenant", action: "enable", apply: false,
    profileId: "pfl_fixture", clearingLedgerId: 3, paymentsFrom: "2099-06-10T21:00:00.000Z" });
  const preview = await configureReceiptAutomation(f.command, f.dependencies);
  assert.equal(preview.applied, false); assert.equal(f.state.verifies, 1); assert.equal(f.state.saves.length, 0);
  const applied = await configureReceiptAutomation({ ...f.command, apply: true }, f.dependencies);
  assert.equal(applied.applied, true); assert.equal(f.state.saves.length, 1); assert.equal(f.state.saves[0].mode, "live");
  assert.equal(f.state.saves[0].credentialVersion, f.state.credentialVersion);
});

test("parser rejects unknown, duplicate, incomplete and ambiguous setup options", () => {
  for (const args of [[], ["--tenant-id", "tenant"], ["--enable"], [...argumentsForEnable, "--enable"],
    [...argumentsForEnable, "--disable"], [...argumentsForEnable, "--mode", "test"], [...argumentsForEnable, "--apply", "--apply"],
    ["--tenant-id", "--enable"], [...argumentsForEnable, "--tenant-id", "other"]]) {
    assert.throws(() => parseReceiptConfiguration(args));
  }
});

test("parser rejects malformed profiles, IDs and invalid calendar/timezone cutovers", () => {
  for (const [option, value] of [["--profile-id", "tr_wrong"], ["--profile-id", "pfl_with space"],
    ["--clearing-ledger-id", "-1"], ["--clearing-ledger-id", "0"], ["--clearing-ledger-id", "1e2"],
    ["--clearing-ledger-id", "9007199254740992"], ["--payments-from", "2099-06-10"],
    ["--payments-from", "2099-06-10T12:00:00"], ["--payments-from", "2099-02-30T12:00:00Z"],
    ["--payments-from", "2099-13-01T12:00:00Z"], ["--payments-from", "2099-06-10T25:00:00Z"]]) {
    const args = [...argumentsForEnable]; args[args.indexOf(option) + 1] = value;
    assert.throws(() => parseReceiptConfiguration(args), `${option}=${value}`);
  }
});

test("disable preview and apply do not read credentials or contact providers", async () => {
  const f = fixture(); const command = parseReceiptConfiguration(["--tenant-id", "tenant", "--disable"]);
  assert.deepEqual(await configureReceiptAutomation(command, f.dependencies), { applied: false, tenantId: "tenant", enabled: false });
  assert.deepEqual(await configureReceiptAutomation({ ...command, apply: true }, f.dependencies), { applied: true, tenantId: "tenant", enabled: false });
  assert.equal(f.state.reads, 0); assert.equal(f.state.verifies, 0); assert.deepEqual(f.state.disabled, ["tenant"]);
  assert.throws(() => parseReceiptConfiguration(["--tenant-id", "tenant", "--disable", "--profile-id", "pfl_fixture"]));
});

test("new historical cutovers fail before provider verification but an unchanged prior cutoff can be re-enabled", async () => {
  const f = fixture(); const command: ReceiptConfigurationCommand = { tenantId: "tenant", apply: true, action: "enable",
    profileId: "pfl_fixture", clearingLedgerId: 3, paymentsFrom: "2026-06-01T00:00:00Z" };
  await assert.rejects(() => configureReceiptAutomation(command, f.dependencies), /future/);
  assert.equal(f.state.verifies, 0); assert.equal(f.state.saves.length, 0);
  f.state.current = { tenantId: "tenant", mode: "live", enabled: false, profileId: "pfl_fixture", clearingLedgerId: 3,
    paymentsFrom: "2026-06-01T02:00:00+02:00", credentialVersion: f.state.credentialVersion };
  assert.equal((await configureReceiptAutomation(command, f.dependencies)).applied, true); assert.equal(f.state.saves.length, 1);
});

test("profile mismatch, non-financial ledger and invalid credential version cannot be saved", async () => {
  for (const change of ["profile", "ledger", "credential"] as const) {
    const f = fixture(); if (change === "profile") f.state.providerProfile = "pfl_other";
    if (change === "ledger") f.state.financialLedgerIds = [4]; if (change === "credential") f.state.credentialVersion = "invalid";
    await assert.rejects(() => configureReceiptAutomation({ ...f.command, apply: true }, f.dependencies), /does not match/);
    assert.equal(f.state.saves.length, 0);
  }
});

test("an unchanged historical cutoff cannot be reused for a different account, profile or credential version", async () => {
  for (const change of ["profile", "ledger", "credential"] as const) {
    const f = fixture();
    f.state.current = { tenantId: "tenant", mode: "live", enabled: false, profileId: "pfl_fixture", clearingLedgerId: 3,
      paymentsFrom: "2026-06-01T00:00:00Z", credentialVersion: "2026-05-01T00:00:00Z" };
    f.state.credentialVersion = f.state.current.credentialVersion;
    const command: ReceiptConfigurationCommand = { tenantId: "tenant", action: "enable", apply: true,
      profileId: "pfl_fixture", clearingLedgerId: 3, paymentsFrom: f.state.current.paymentsFrom };
    if (change === "profile") { command.profileId = "pfl_other"; f.state.providerProfile = "pfl_other"; }
    if (change === "ledger") { command.clearingLedgerId = 4; f.state.financialLedgerIds = [4]; }
    if (change === "credential") f.state.credentialVersion = "2026-05-02T00:00:00Z";
    await assert.rejects(() => configureReceiptAutomation(command, f.dependencies), /new future cutoff/);
    assert.equal(f.state.saves.length, 0);
  }
});

test("provider verification failures and missing tenant context cannot persist configuration", async () => {
  const f = fixture(); f.dependencies.verify = async () => { throw new Error("Provider unavailable"); };
  await assert.rejects(() => configureReceiptAutomation({ ...f.command, apply: true }, f.dependencies), /Provider unavailable/);
  await assert.rejects(() => configureReceiptAutomation({ ...f.command, tenantId: "" }, f.dependencies), /Tenant context/);
  assert.equal(f.state.saves.length, 0);
});
