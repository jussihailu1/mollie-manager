import "server-only";

import { sql } from "drizzle-orm";

import {
  billingSettingsAreComplete,
  getTenantBillingSettings,
} from "@/lib/billing-settings";
import { getDb } from "@/lib/db";
import { getTenantEboekhoudenCredentials } from "@/lib/eboekhouden/tenant-credentials";
import { env, getSetupStatus } from "@/lib/env";
import { getInvoiceProviderAdapterById } from "@/lib/invoicing/provider-resolver";
import { getTenantMollieCredentials } from "@/lib/mollie/tenant-credentials";
import { notificationsAreConfigured } from "@/lib/notifications/email";
import { getTenantSubscriptionPolicyDefaults } from "@/lib/subscription-policy-defaults";

type ReadinessCheck = {
  details?: Record<string, unknown>;
  name: string;
  pass: boolean;
};

type TenantLookupRow = {
  id: string;
  name: string;
  slug: string;
};

function buildReadinessStatus(checks: ReadinessCheck[]) {
  return {
    checks,
    pass: checks.every((check) => check.pass),
  };
}

async function getTenantLookup(tenantId: string) {
  const result = await getDb().execute<TenantLookupRow>(sql`
    select
      id,
      name,
      slug
    from tenants
    where id = ${tenantId}
    limit 1
  `);

  return result.rows[0] ?? null;
}

export function getPlatformReadiness() {
  const setupStatus = getSetupStatus();
  const notificationsConfigured = notificationsAreConfigured();
  const checks: ReadinessCheck[] = [
    {
      details: {
        hasAppUrl: Boolean(env.APP_URL),
        hasAuthUrl: Boolean(env.AUTH_URL),
      },
      name: "app_url_configured",
      pass: Boolean(env.APP_URL || env.AUTH_URL),
    },
    {
      details: {
        hasCronSecret: Boolean(process.env.CRON_SECRET?.trim()),
        hasInvoiceCronSharedSecret: Boolean(
          env.INVOICE_CRON_SHARED_SECRET?.trim(),
        ),
      },
      name: "cron_secret_configured",
      pass: Boolean(
        process.env.CRON_SECRET?.trim() || env.INVOICE_CRON_SHARED_SECRET?.trim(),
      ),
    },
    {
      details: {
        notificationsConfigured,
      },
      name: "notifications_configured",
      pass: notificationsConfigured,
    },
    {
      details: {
        readySections: Object.fromEntries(
          Object.entries(setupStatus).map(([key, value]) => [key, value.ready]),
        ),
      },
      name: "platform_setup_ready",
      pass: Object.values(setupStatus).every((section) => section.ready),
    },
  ];

  return {
    ...buildReadinessStatus(checks),
    setupStatus,
  };
}

export async function getTenantReadiness(tenantId: string) {
  const tenant = await getTenantLookup(tenantId);
  const [mollieCredentials, eboekhoudenCredentials, billingSettings] =
    tenant === null
      ? [null, null, null]
      : await Promise.all([
          getTenantMollieCredentials(tenantId, "live"),
          getTenantEboekhoudenCredentials(tenantId),
          getTenantBillingSettings(tenantId),
        ]);
  const activeInvoiceProvider = billingSettings?.activeInvoiceProvider ?? null;
  const activeProviderValidation =
    tenant === null || billingSettings === null || activeInvoiceProvider === null
      ? {
          ok: false,
          reason:
            tenant === null
              ? "Tenant does not exist."
              : "Tenant billing settings are missing.",
        }
      : await getInvoiceProviderAdapterById(activeInvoiceProvider).validateTenantSetup({
          mode: "live",
          settings: billingSettings,
          tenantId,
        });

  let subscriptionPolicyDefaultsReady = false;
  let subscriptionPolicyDefaultsIssue: string | null = null;

  if (tenant !== null) {
    try {
      await getTenantSubscriptionPolicyDefaults(tenantId);
      subscriptionPolicyDefaultsReady = true;
    } catch (error) {
      subscriptionPolicyDefaultsIssue =
        error instanceof Error ? error.message : "Unknown tenant policy error.";
    }
  }

  const checks: ReadinessCheck[] = [
    {
      details: tenant,
      name: "tenant_exists",
      pass: tenant !== null,
    },
    {
      details: {
        mode: "live",
      },
      name: "tenant_live_mode_only",
      pass: true,
    },
    {
      details: {
        mode: "live",
        present: mollieCredentials !== null,
        required: activeInvoiceProvider === "mollie",
      },
      name: "tenant_mollie_live_configured",
      pass: activeInvoiceProvider === "mollie" ? mollieCredentials !== null : true,
    },
    {
      details: {
        present: eboekhoudenCredentials !== null,
        required: activeInvoiceProvider === "eboekhouden",
      },
      name: "tenant_eboekhouden_configured",
      pass:
        activeInvoiceProvider === "eboekhouden"
          ? eboekhoudenCredentials !== null
          : true,
    },
    {
      details: {
        activeInvoiceProvider,
      },
      name: "tenant_active_invoice_provider_selected",
      pass: activeInvoiceProvider !== null,
    },
    {
      details: {
        activeInvoiceProvider,
        invoiceTemplateId: billingSettings?.invoiceTemplateId ?? null,
        revenueLedgerId: billingSettings?.revenueLedgerId ?? null,
      },
      name: "tenant_billing_settings_complete",
      pass: billingSettingsAreComplete(billingSettings),
    },
    {
      details: {
        activeInvoiceProvider,
        issue: activeProviderValidation.reason ?? null,
      },
      name: "tenant_active_invoice_provider_ready",
      pass: activeProviderValidation.ok,
    },
    {
      details: {
        issue: subscriptionPolicyDefaultsIssue,
      },
      name: "tenant_subscription_policy_defaults_ready",
      pass: subscriptionPolicyDefaultsReady,
    },
  ];

  return {
    ...buildReadinessStatus(checks),
    tenant,
  };
}
