import "server-only";

import { sql } from "drizzle-orm";

import { getDb, transaction } from "@/lib/db";
import {
  listEboekhoudenInvoiceTemplates,
  listEboekhoudenLedgers,
  type EboekhoudenInvoiceTemplate,
  type EboekhoudenLedger,
} from "@/lib/eboekhouden/client";

export const TENANT_BILLING_SETTINGS_ID = "default";
export const DEFAULT_SUBSCRIPTION_VAT_CODE = "HOOG_VERK_21";
export const DEFAULT_SUBSCRIPTION_VAT_PERCENTAGE = "21.00";

export type TenantBillingSettings = {
  id: string;
  invoiceEmailDeliveryMode: "app_smtp" | "eboekhouden" | "none";
  invoiceLineDescriptionSource: string;
  invoiceTemplateId: number | null;
  revenueLedgerId: number | null;
  vatCode: string;
  vatPercentage: string;
};

export type BillingDiscovery = {
  invoiceTemplates: EboekhoudenInvoiceTemplate[];
  ledgers: EboekhoudenLedger[];
  suggestedRevenueLedgers: EboekhoudenLedger[];
};

function normalizeItems<T>(items: T[] | undefined) {
  return Array.isArray(items) ? items : [];
}

function ledgerLabel(ledger: EboekhoudenLedger) {
  return [
    ledger.code,
    ledger.description,
    ledger.name,
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ")
    .toLowerCase();
}

export async function ensureTenantBillingSettings() {
  await transaction(async (tx) => {
    await tx.execute(sql`
      insert into tenant_billing_settings (
        id,
        vat_code,
        vat_percentage,
        invoice_line_description_source,
        invoice_email_delivery_mode,
        created_at,
        updated_at
      ) values (
        ${TENANT_BILLING_SETTINGS_ID},
        ${DEFAULT_SUBSCRIPTION_VAT_CODE},
        ${DEFAULT_SUBSCRIPTION_VAT_PERCENTAGE},
        'subscription_description',
        'app_smtp',
        now(),
        now()
      )
      on conflict (id) do nothing
    `);
  });

  return getTenantBillingSettings();
}

export async function getTenantBillingSettings() {
  const result = await getDb().execute<TenantBillingSettings>(sql`
    select
      id,
      invoice_template_id as "invoiceTemplateId",
      revenue_ledger_id as "revenueLedgerId",
      vat_code as "vatCode",
      vat_percentage::text as "vatPercentage",
      invoice_line_description_source as "invoiceLineDescriptionSource",
      invoice_email_delivery_mode as "invoiceEmailDeliveryMode"
    from tenant_billing_settings
    where id = ${TENANT_BILLING_SETTINGS_ID}
    limit 1
  `);

  return result.rows[0] ?? null;
}

export async function updateTenantBillingSettings(input: {
  invoiceEmailDeliveryMode: "app_smtp" | "eboekhouden" | "none";
  invoiceTemplateId: number | null;
  revenueLedgerId: number | null;
}) {
  await transaction(async (tx) => {
    await tx.execute(sql`
      insert into tenant_billing_settings (
        id,
        invoice_template_id,
        revenue_ledger_id,
        vat_code,
        vat_percentage,
        invoice_line_description_source,
        invoice_email_delivery_mode,
        created_at,
        updated_at
      ) values (
        ${TENANT_BILLING_SETTINGS_ID},
        ${input.invoiceTemplateId},
        ${input.revenueLedgerId},
        ${DEFAULT_SUBSCRIPTION_VAT_CODE},
        ${DEFAULT_SUBSCRIPTION_VAT_PERCENTAGE},
        'subscription_description',
        ${input.invoiceEmailDeliveryMode},
        now(),
        now()
      )
      on conflict (id)
      do update set
        invoice_template_id = excluded.invoice_template_id,
        revenue_ledger_id = excluded.revenue_ledger_id,
        vat_code = excluded.vat_code,
        vat_percentage = excluded.vat_percentage,
        invoice_line_description_source = excluded.invoice_line_description_source,
        invoice_email_delivery_mode = excluded.invoice_email_delivery_mode,
        updated_at = now()
    `);
  });

  return getTenantBillingSettings();
}

export async function discoverEboekhoudenBillingSettings(): Promise<BillingDiscovery> {
  const [templateResponse, ledgerResponse] = await Promise.all([
    listEboekhoudenInvoiceTemplates({ active: true }),
    listEboekhoudenLedgers(),
  ]);
  const invoiceTemplates = normalizeItems(templateResponse.items);
  const ledgers = normalizeItems(ledgerResponse.items);
  const suggestedRevenueLedgers = ledgers.filter((ledger) => {
    const label = ledgerLabel(ledger);
    return (
      label.includes("omzet") ||
      label.includes("abonnement") ||
      label.includes("subscription") ||
      label.startsWith("8")
    );
  });

  return {
    invoiceTemplates,
    ledgers,
    suggestedRevenueLedgers:
      suggestedRevenueLedgers.length > 0 ? suggestedRevenueLedgers : ledgers.slice(0, 20),
  };
}

export function billingSettingsAreComplete(
  settings: TenantBillingSettings | null,
) {
  return Boolean(settings?.invoiceTemplateId && settings.revenueLedgerId);
}
