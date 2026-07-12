import { sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import type { MollieMode } from "@/lib/env";
import {
  buildInvoiceStateDeltaSummary,
  FIRST_PAYMENT_INVOICE_STATES,
  mapInvoiceStateCounts,
  RECURRING_INVOICE_STATES,
  type FirstPaymentInvoiceState,
  type InvoiceStateCountMap,
  type ReconciliationSummary,
  type RecurringInvoiceState,
} from "@/lib/reliability/reconciliation-summary";
import type { SyncActor } from "@/lib/reliability/sync-persistence";
import type { ReconciliationMode } from "@/lib/reliability/reconciliation-mode";

type InvoiceStateCountRow<TState extends string> = {
  count: number | string;
  state: TState;
};

export type ReconciliationDependencies = {
  syncPaymentByMollieId: (molliePaymentId: string, options: {
    actor: SyncActor;
    preferredMode?: MollieMode;
    reconciliationMode: ReconciliationMode;
    strictMode?: boolean;
    tenantId: string;
  }) => Promise<unknown>;
  syncPaymentLinkByMollieId: (molliePaymentLinkId: string, options: {
    actor: SyncActor;
    preferredMode?: MollieMode;
    strictMode?: boolean;
    tenantId: string;
  }) => Promise<unknown>;
  syncSubscriptionByLocalId: (localSubscriptionId: string, options: {
    actor: SyncActor;
    reconciliationMode: ReconciliationMode;
    strictMode?: boolean;
    tenantId: string;
  }) => Promise<unknown>;
};

function requireTenantId(tenantId?: string) {
  if (!tenantId) {
    throw new Error("Explicit tenant context is required.");
  }

  return tenantId;
}

async function getFirstPaymentInvoiceStateCounts(
  mode?: MollieMode | null,
  tenantId?: string,
): Promise<InvoiceStateCountMap<FirstPaymentInvoiceState>> {
  const modeParam = mode ?? null;
  const tenantParam = requireTenantId(tenantId);
  const result = await getDb().execute<InvoiceStateCountRow<FirstPaymentInvoiceState>>(sql`
      select
        invoice_state as state,
        count(*)::int as count
      from payments
      where payment_type = 'first'
        and (${modeParam}::mollie_mode is null or mode = ${modeParam})
        and tenant_id = ${tenantParam}
      group by invoice_state
    `);

  return mapInvoiceStateCounts(FIRST_PAYMENT_INVOICE_STATES, result.rows);
}

async function getRecurringInvoiceStateCounts(
  mode?: MollieMode | null,
  tenantId?: string,
): Promise<InvoiceStateCountMap<RecurringInvoiceState>> {
  const modeParam = mode ?? null;
  const tenantParam = requireTenantId(tenantId);
  const result = await getDb().execute<InvoiceStateCountRow<RecurringInvoiceState>>(sql`
      select
        invoice_state as state,
        count(*)::int as count
      from recurring_billing_schedules
      where (${modeParam}::mollie_mode is null or mode = ${modeParam})
        and tenant_id = ${tenantParam}
      group by invoice_state
    `);

  return mapInvoiceStateCounts(RECURRING_INVOICE_STATES, result.rows);
}

export async function reconcileOperationalData(
  input: {
    actor?: SyncActor;
    mode?: MollieMode;
    reconciliationMode?: ReconciliationMode;
    tenantId: string;
  } & ReconciliationDependencies,
): Promise<ReconciliationSummary> {
  const effectiveActor = input.actor ?? {
    kind: "system" as const,
  };
  const modeParam = input.mode ?? null;
  const tenantId = requireTenantId(input.tenantId);
  const reconciliationMode = input.reconciliationMode ?? "full";
  const [
    beforeFirstPaymentInvoiceStates,
    beforeRecurringInvoiceStates,
    subscriptions,
    firstPayments,
    paymentLinks,
  ] = await Promise.all([ 
    getFirstPaymentInvoiceStateCounts(modeParam, tenantId),
    getRecurringInvoiceStateCounts(modeParam, tenantId),
    getDb().execute<{ id: string }>(sql`
      select id
      from subscriptions
      where (${modeParam}::mollie_mode is null or mode = ${modeParam})
        and tenant_id = ${tenantId}
        order by created_at desc
    `),
    getDb().execute<{ molliePaymentId: string }>(sql`
      select mollie_payment_id as "molliePaymentId"
      from payments
      where payment_type = 'first'
        and mollie_payment_id is not null
        and (${modeParam}::mollie_mode is null or mode = ${modeParam})
        and tenant_id = ${tenantId}
      order by created_at desc
    `),
    getDb().execute<{ molliePaymentLinkId: string }>(sql`
      select mollie_payment_link_id as "molliePaymentLinkId"
      from payment_links
      where mollie_payment_link_id is not null
        and (${modeParam}::mollie_mode is null or mode = ${modeParam})
        and tenant_id = ${tenantId}
        and metadata ->> 'source' = 'subscription_onboarding'
        and metadata ->> 'paymentType' = 'first'
      order by created_at desc
    `),
  ]);

  for (const subscription of subscriptions.rows) {
    await input.syncSubscriptionByLocalId(subscription.id, {
      actor: effectiveActor,
      reconciliationMode,
      strictMode: Boolean(input.mode),
      tenantId,
    });
  }

  for (const paymentLink of paymentLinks.rows) {
    await input.syncPaymentLinkByMollieId(paymentLink.molliePaymentLinkId, {
      actor: effectiveActor,
      preferredMode: input.mode,
      strictMode: Boolean(input.mode),
      tenantId,
    });
  }

  for (const payment of firstPayments.rows) {
    await input.syncPaymentByMollieId(payment.molliePaymentId, {
      actor: effectiveActor,
      preferredMode: input.mode,
      reconciliationMode,
      strictMode: Boolean(input.mode),
      tenantId,
    });
  }

  const [afterFirstPaymentInvoiceStates, afterRecurringInvoiceStates] =
    await Promise.all([
      getFirstPaymentInvoiceStateCounts(modeParam, tenantId),
      getRecurringInvoiceStateCounts(modeParam, tenantId),
    ]);

  const result: ReconciliationSummary = {
    firstPaymentInvoiceStateDelta: buildInvoiceStateDeltaSummary(
      FIRST_PAYMENT_INVOICE_STATES,
      beforeFirstPaymentInvoiceStates,
      afterFirstPaymentInvoiceStates,
    ),
    firstPaymentsChecked: firstPayments.rows.length,
    mode: modeParam,
    paymentLinksChecked: paymentLinks.rows.length,
    ranAt: new Date().toISOString(),
    reconciliationMode,
    recurringInvoiceStateDelta: buildInvoiceStateDeltaSummary(
      RECURRING_INVOICE_STATES,
      beforeRecurringInvoiceStates,
      afterRecurringInvoiceStates,
    ),
    subscriptionsChecked: subscriptions.rows.length,
  };

  return result;
}
