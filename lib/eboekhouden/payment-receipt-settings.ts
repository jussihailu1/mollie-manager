import "server-only";
import { sql } from "drizzle-orm";
import { getDb, transaction } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { getTenantMollieClient, getTenantMollieRequestContext } from "@/lib/mollie/client";
import { listEboekhoudenLedgers, refreshEboekhoudenSession } from "./client";
import { readAllEboekhoudenPages } from "./pagination";
import type { ReceiptSettings } from "./payment-receipt-contract";
import type { ReceiptConfigurationCommand } from "./payment-receipt-configuration";
import { configureReceiptAutomation } from "./payment-receipt-configuration";

export async function configureTenantReceiptAutomation(command: ReceiptConfigurationCommand) {
  return configureReceiptAutomation(command, {
    now: Date.now,
    current: async tenantId => {
      const result = await getDb().execute<ReceiptSettings>(sql`select tenant_id as "tenantId", mode, enabled,
        profile_id as "profileId", clearing_ledger_id as "clearingLedgerId", payments_from::text as "paymentsFrom",
        credential_version::text as "credentialVersion" from tenant_eboekhouden_receipt_settings where tenant_id = ${tenantId} and mode = 'live'`);
      return result.rows[0] ?? null;
    },
    verify: async tenantId => {
      const credentials = await getDb().execute<{ version: string }>(sql`
        select updated_at::text as version from tenant_eboekhouden_credentials where tenant_id = ${tenantId}`);
      if (credentials.rows.length !== 1) throw new Error("Tenant accounting credentials required");
      await refreshEboekhoudenSession(tenantId);
      const [client, context, ledgers] = await Promise.all([
        getTenantMollieClient(tenantId, "live"), getTenantMollieRequestContext(tenantId, "live"),
        readAllEboekhoudenPages((limit, offset) => listEboekhoudenLedgers({ tenantId, limit, offset })),
      ]);
      const profile = context.profileId ? await client.profiles.get(context.profileId) : await client.profiles.getCurrent();
      return { credentialVersion: credentials.rows[0].version, profileId: profile.id,
        financialLedgerIds: ledgers.filter(ledger => ledger.category === "FIN").map(ledger => ledger.id) };
    },
    save: async settings => transaction(async tx => {
      // Lock the credential row through commit so the saved version describes
      // the administration just verified. Existing claims prevent rebinding.
      const credential = await tx.execute<{ version: string }>(sql`select updated_at::text as version
        from tenant_eboekhouden_credentials where tenant_id = ${settings.tenantId} for share`);
      if (credential.rows[0]?.version !== settings.credentialVersion) throw new Error("Accounting credentials changed during setup");
      const saved = await tx.execute(sql`
        insert into tenant_eboekhouden_receipt_settings (tenant_id, mode, enabled, profile_id, clearing_ledger_id, payments_from, credential_version)
        values (${settings.tenantId}, 'live', true, ${settings.profileId}, ${settings.clearingLedgerId}, ${settings.paymentsFrom}::timestamptz, ${settings.credentialVersion}::timestamptz)
        on conflict (tenant_id) do update set enabled = true, profile_id = excluded.profile_id,
          clearing_ledger_id = excluded.clearing_ledger_id, payments_from = excluded.payments_from,
          credential_version = excluded.credential_version, updated_at = now()
        where not exists (select 1 from eboekhouden_payment_receipts where tenant_id = ${settings.tenantId})
          or (tenant_eboekhouden_receipt_settings.profile_id = excluded.profile_id
            and tenant_eboekhouden_receipt_settings.clearing_ledger_id = excluded.clearing_ledger_id
            and tenant_eboekhouden_receipt_settings.payments_from = excluded.payments_from
            and tenant_eboekhouden_receipt_settings.credential_version = excluded.credential_version)
        returning tenant_id
      `);
      if (saved.rows.length !== 1) throw new Error("Existing receipt claims require explicit review before changing their account/profile/cutover");
      await writeAuditLog({ action: "eboekhouden.receipt_settings.enable", entityType: "tenant", entityId: settings.tenantId,
        mode: "live", outcome: "success", summary: "Configured future Mollie gross receipts.",
        details: { profileId: settings.profileId, clearingLedgerId: settings.clearingLedgerId, paymentsFrom: settings.paymentsFrom } }, tx, { kind: "system" });
    }),
    disable: async tenantId => transaction(async tx => {
      await tx.execute(sql`update tenant_eboekhouden_receipt_settings set enabled = false, updated_at = now()
        where tenant_id = ${tenantId} and mode = 'live'`);
      await writeAuditLog({ action: "eboekhouden.receipt_settings.disable", entityType: "tenant", entityId: tenantId,
        mode: "live", outcome: "success", summary: "Disabled future Mollie receipt posting; retained receipt evidence." }, tx, { kind: "system" });
    }),
  });
}
