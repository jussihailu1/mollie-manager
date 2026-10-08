#!/usr/bin/env node

import process from "node:process";

import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1] ?? null;
}

async function main() {
  const tenantId = argument("--tenant-id");
  const mode = argument("--mode");
  const ownerType = argument("--owner-type");
  const ownerId = argument("--owner-id");
  const operatorEmail = argument("--operator-email");
  const creditedInvoiceId = Number(argument("--credited-invoice-id"));
  const replacementInvoiceId = Number(argument("--replacement-invoice-id"));
  const creditNoteNumber = argument("--credit-note-number");
  if (!tenantId || !ownerId || !operatorEmail || !creditNoteNumber ||
      (mode !== "live" && mode !== "test") ||
      (ownerType !== "payment" && ownerType !== "recurring_schedule")) {
    throw new Error("Required: --tenant-id, --mode live|test, --owner-type payment|recurring_schedule, --owner-id, --operator-email, --credited-invoice-id, --replacement-invoice-id, --credit-note-number. Add --apply only after reviewing the dry run.");
  }
  const { recoverCreditedEboekhoudenInvoice } = await import("@/lib/eboekhouden/manual-invoice-recovery");
  const result = await recoverCreditedEboekhoudenInvoice({
    apply: process.argv.includes("--apply"),
    creditNoteNumber,
    creditedInvoiceId,
    mode,
    ownerId,
    ownerType,
    operatorEmail,
    replacementInvoiceId,
    tenantId,
  });
  console.log(JSON.stringify(result, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
