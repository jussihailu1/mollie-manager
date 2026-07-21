import "server-only";

import { sql } from "drizzle-orm";

import { getDb, transaction } from "@/lib/db";
import {
  listEboekhoudenInvoiceTemplates,
  listEboekhoudenLedgers,
  type EboekhoudenInvoiceTemplate,
  type EboekhoudenLedger,
} from "@/lib/eboekhouden/client";
import type { InvoiceProvider } from "@/lib/invoices";

export const DEFAULT_SUBSCRIPTION_VAT_CODE = "HOOG_VERK_21";
export const DEFAULT_SUBSCRIPTION_VAT_PERCENTAGE = "21.00";

export type TenantBillingSettings = {
  activeInvoiceProvider: InvoiceProvider;
  id: string;
  invoiceEmailDeliveryMode: "app_smtp" | "eboekhouden" | "none";
  invoiceLineDescriptionSource: string;
  invoiceTemplateId: number | null;
  revenueLedgerId: number | null;
  revenueLedgerName: string;
  tenantId: string;
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
  return [ledger.code, ledger.description, ledger.name]
    .filter(
      (value): value is string =>
        typeof value === "string" && value.length > 0,
    )
    .join(" ")
    .toLowerCase();
}

async function resolveTenantId(tenantId: string) {
  return tenantId;
}

export async function ensureTenantBillingSettings(tenantId: string) {
  const resolvedTenantId = await resolveTenantId(tenantId);

  await transaction(async (tx) => {
    await tx.execute(sql`
      insert into tenant_billing_settings (
        id,
        tenant_id,
        active_invoice_provider,
        vat_code,
        vat_percentage,
        invoice_line_description_source,
        invoice_email_delivery_mode,
        created_at,
        updated_at
      ) values (
        ${resolvedTenantId},
        ${resolvedTenantId},
        'mollie',
        ${DEFAULT_SUBSCRIPTION_VAT_CODE},
        ${DEFAULT_SUBSCRIPTION_VAT_PERCENTAGE},
        'subscription_description',
        'app_smtp',
        now(),
        now()
      )
      on conflict (tenant_id) do nothing
    `);

    await tx.execute(sql`
      insert into tenant_eboekhouden_invoice_settings (
        id,
        tenant_id,
        created_at,
        updated_at
      ) values (
        ${resolvedTenantId},
        ${resolvedTenantId},
        now(),
        now()
      )
      on conflict (tenant_id) do nothing
    `);
  });

  return getTenantBillingSettings(resolvedTenantId);
}

export async function getTenantBillingSettings(tenantId: string) {
  const resolvedTenantId = await resolveTenantId(tenantId);
  const result = await getDb().execute<TenantBillingSettings>(sql`
    select
      tbs.id,
      tbs.tenant_id as "tenantId",
      tbs.active_invoice_provider as "activeInvoiceProvider",
      teis.invoice_template_id as "invoiceTemplateId",
      teis.revenue_ledger_id as "revenueLedgerId",
      teis.revenue_ledger_name as "revenueLedgerName",
      tbs.vat_code as "vatCode",
      tbs.vat_percentage::text as "vatPercentage",
      tbs.invoice_line_description_source as "invoiceLineDescriptionSource",
      tbs.invoice_email_delivery_mode as "invoiceEmailDeliveryMode"
    from tenant_billing_settings tbs
    left join tenant_eboekhouden_invoice_settings teis
      on teis.tenant_id = tbs.tenant_id
    where tbs.tenant_id = ${resolvedTenantId}
    limit 1
  `);

  return result.rows[0] ?? null;
}

export async function getTenantActiveInvoiceProvider(tenantId: string) {
  const settings = await ensureTenantBillingSettings(tenantId);
  return settings?.activeInvoiceProvider ?? "mollie";
}

export async function updateTenantBillingSettings(
  input: {
    activeInvoiceProvider: InvoiceProvider;
    invoiceEmailDeliveryMode: "app_smtp" | "eboekhouden" | "none";
    invoiceTemplateId: number | null;
    revenueLedgerId: number | null;
  },
  tenantId: string,
) {
  const resolvedTenantId = await resolveTenantId(tenantId);

  await transaction(async (tx) => {
    await tx.execute(sql`
      insert into tenant_billing_settings (
        id,
        tenant_id,
        active_invoice_provider,
        vat_code,
        vat_percentage,
        invoice_line_description_source,
        invoice_email_delivery_mode,
        created_at,
        updated_at
      ) values (
        ${resolvedTenantId},
        ${resolvedTenantId},
        ${input.activeInvoiceProvider}::invoice_provider,
        ${DEFAULT_SUBSCRIPTION_VAT_CODE},
        ${DEFAULT_SUBSCRIPTION_VAT_PERCENTAGE},
        'subscription_description',
        ${input.invoiceEmailDeliveryMode},
        now(),
        now()
      )
      on conflict (tenant_id)
      do update set
        active_invoice_provider = excluded.active_invoice_provider,
        vat_code = excluded.vat_code,
        vat_percentage = excluded.vat_percentage,
        invoice_line_description_source = excluded.invoice_line_description_source,
        invoice_email_delivery_mode = excluded.invoice_email_delivery_mode,
        updated_at = now()
    `);

    await tx.execute(sql`
      insert into tenant_eboekhouden_invoice_settings (
        id,
        tenant_id,
        invoice_template_id,
        revenue_ledger_id,
        created_at,
        updated_at
      ) values (
        ${resolvedTenantId},
        ${resolvedTenantId},
        ${input.invoiceTemplateId},
        ${input.revenueLedgerId},
        now(),
        now()
      )
      on conflict (tenant_id)
      do update set
        invoice_template_id = excluded.invoice_template_id,
        revenue_ledger_id = excluded.revenue_ledger_id,
        updated_at = now()
    `);
  });

  return getTenantBillingSettings(resolvedTenantId);
}

export async function discoverEboekhoudenBillingSettings(
  tenantId: string,
): Promise<BillingDiscovery> {
  const [templateResponse, ledgerResponse] = await Promise.all([
    listEboekhoudenInvoiceTemplates({ active: true, tenantId }),
    listEboekhoudenLedgers({ tenantId }),
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
  if (!settings) {
    return false;
  }

  if (settings.activeInvoiceProvider === "mollie" || settings.activeInvoiceProvider === "kify") {
    return true;
  }

  return Boolean(settings.invoiceTemplateId && settings.revenueLedgerId);
}
