import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { billingSettingsAreComplete, getTenantBillingSettings } from "@/lib/billing-settings";
import { getKifyInvoiceReadiness } from "@/lib/invoicing/kify-readiness-query";
import { getInvoiceProviderAdapterById } from "@/lib/invoicing/provider-resolver";
import { notificationsAreConfigured } from "@/lib/notifications/email";
import type { MollieMode } from "@/lib/env";
import { getEboekhoudenRelation } from "@/lib/eboekhouden/client";

// A mandate-only payment still commits us to future invoices. Check the same
// prerequisites before either kind of first payment can be requested.
export async function getOnboardingInvoiceReadiness(input: { customerId: string; tenantId: string; mode: MollieMode }) {
  const settings = await getTenantBillingSettings(input.tenantId);
  if (!billingSettingsAreComplete(settings)) return { ok: false, reason: "Complete the invoice provider, tax and invoice settings before creating a consent link." };
  if (!notificationsAreConfigured() || settings?.invoiceEmailDeliveryMode !== "app_smtp") return { ok: false, reason: "Enable automatic customer invoice email delivery before creating a consent link." };
  if (settings!.activeInvoiceProvider === "kify") return getKifyInvoiceReadiness(input);
  const validation = await getInvoiceProviderAdapterById(settings!.activeInvoiceProvider).validateTenantSetup({ ...input, settings });
  if (!validation.ok) return { ok: false, reason: validation.reason ?? "The invoice provider is not ready." };
  const result = await getDb().execute<{ email: string | null; relationId: string | null }>(sql`
    select coalesce(nullif(trim(p.email), ''), c.email) as email, cal.provider_customer_id as "relationId"
    from customers c
    left join customer_billing_profiles p on p.customer_id = c.id and p.tenant_id = c.tenant_id
    left join customer_accounting_links cal on cal.customer_id = c.id and cal.tenant_id = c.tenant_id
      and cal.mode = c.mode and cal.provider = ${settings!.activeInvoiceProvider}
    where c.id = ${input.customerId} and c.tenant_id = ${input.tenantId} and c.mode = ${input.mode} and c.archived_at is null
  `);
  const row = result.rows[0];
  if (!row?.email) return { ok: false, reason: "Add the customer's invoice email before creating a consent link." };
  if (settings!.activeInvoiceProvider === "eboekhouden" && !/^[1-9]\d*$/.test(row.relationId ?? "")) return { ok: false, reason: "Link this customer to an e-Boekhouden relation before creating a consent link." };
  if (settings!.activeInvoiceProvider === "eboekhouden") {
    try { await getEboekhoudenRelation(Number(row.relationId), input.tenantId); }
    catch { return { ok: false, reason: "The accounting connection or customer relation could not be verified. Check the e-Boekhouden connection before creating a consent link." }; }
  }
  return { ok: true, reason: null };
}
