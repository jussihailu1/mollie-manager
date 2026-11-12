import type { ReceiptSettings } from "./payment-receipt-contract";

export type ReceiptConfigurationCommand = {
  tenantId: string; apply: boolean;
} & ({ action: "disable" } | { action: "enable"; profileId: string; clearingLedgerId: number; paymentsFrom: string });

export function parseReceiptConfiguration(args: string[]): ReceiptConfigurationCommand {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (values.has(key) || flags.has(key)) throw new Error("Duplicate receipt configuration option");
    if (["--apply", "--enable", "--disable"].includes(key)) { flags.add(key); continue; }
    if (!["--tenant-id", "--profile-id", "--clearing-ledger-id", "--payments-from"].includes(key) ||
        !args[index + 1] || args[index + 1].startsWith("--")) throw new Error("Unknown or incomplete receipt configuration option");
    values.set(key, args[++index]);
  }
  const tenantId = values.get("--tenant-id")?.trim();
  if (!tenantId || flags.has("--enable") === flags.has("--disable")) throw new Error("Explicit tenant and exactly one of --enable/--disable required");
  const common = { tenantId, apply: flags.has("--apply") };
  if (flags.has("--disable")) {
    if (values.size !== 1) throw new Error("Disabling takes only --tenant-id and optional --apply");
    return { ...common, action: "disable" };
  }
  const profileId = values.get("--profile-id") ?? "";
  const rawLedger = values.get("--clearing-ledger-id") ?? "";
  const clearingLedgerId = Number(rawLedger);
  const timestamp = values.get("--payments-from") ?? "";
  if (!/^pfl_[A-Za-z0-9]+$/.test(profileId) || !/^\d+$/.test(rawLedger) || !Number.isSafeInteger(clearingLedgerId) || clearingLedgerId <= 0) {
    throw new Error("Explicit Mollie profile and positive clearing ledger ID required");
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp) || !Number.isFinite(Date.parse(timestamp))) {
    throw new Error("payments-from must be a timestamp with an explicit timezone");
  }
  const [year, month, day] = timestamp.slice(0, 10).split("-").map(Number);
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) throw new Error("Invalid cutover date");
  return { ...common, action: "enable", profileId, clearingLedgerId, paymentsFrom: new Date(timestamp).toISOString() };
}

export async function configureReceiptAutomation(command: ReceiptConfigurationCommand, dependencies: {
  now(): number;
  verify(tenantId: string): Promise<{ credentialVersion: string; profileId: string; financialLedgerIds: number[] }>;
  current(tenantId: string): Promise<ReceiptSettings | null>;
  save(settings: ReceiptSettings): Promise<void>;
  disable(tenantId: string): Promise<void>;
}) {
  if (!command.tenantId) throw new Error("Tenant context required");
  if (command.action === "disable") {
    if (command.apply) await dependencies.disable(command.tenantId);
    return { applied: command.apply, tenantId: command.tenantId, enabled: false };
  }
  const current = await dependencies.current(command.tenantId);
  const unchangedCutover = current && Date.parse(current.paymentsFrom) === Date.parse(command.paymentsFrom);
  if (!Number.isFinite(Date.parse(command.paymentsFrom)) || (!unchangedCutover && Date.parse(command.paymentsFrom) < dependencies.now())) {
    throw new Error("A new activation cutoff must be in the future; historical receipts need separate review");
  }
  const verified = await dependencies.verify(command.tenantId);
  if (verified.profileId !== command.profileId || !verified.financialLedgerIds.includes(command.clearingLedgerId) ||
      !Number.isFinite(Date.parse(verified.credentialVersion))) throw new Error("The selected account/profile does not match the tenant connection");
  if (Date.parse(command.paymentsFrom) < dependencies.now() && (!current || current.profileId !== command.profileId ||
      current.clearingLedgerId !== command.clearingLedgerId || Date.parse(current.credentialVersion) !== Date.parse(verified.credentialVersion))) {
    throw new Error("A changed account/profile requires a new future cutoff and separate review of existing claims");
  }
  const settings: ReceiptSettings = { tenantId: command.tenantId, mode: "live", enabled: true,
    profileId: command.profileId, clearingLedgerId: command.clearingLedgerId,
    paymentsFrom: command.paymentsFrom, credentialVersion: verified.credentialVersion };
  if (command.apply) await dependencies.save(settings);
  return { applied: command.apply, ...settings };
}
