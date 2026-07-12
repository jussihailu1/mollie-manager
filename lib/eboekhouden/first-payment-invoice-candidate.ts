import { sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { buildDeterministicMatchCte } from "@/lib/eboekhouden/first-payment-invoice-match-query";

export type FirstPaymentInvoiceCandidate = {
  amountValue: string;
  consentAcceptedAt: string | null;
  consentId: string;
  customerEmail: string | null;
  customerId: string | null;
  eboekhoudenRelationId: number | null;
  firstPaymentMode: "mandate_only" | "real_installment";
  mode: "live" | "test";
  molliePaymentId: string | null;
  paidAt: string | null;
  paymentCreatedAt: string;
  paymentId: string;
  paymentLinkId: string;
  planSnapshot: unknown;
  subscriptionId: string | null;
  tenantId: string;
};

export async function getFirstPaymentInvoiceCandidate(
  paymentId: string,
  tenantId: string,
) {
  const result = await getDb().execute<FirstPaymentInvoiceCandidate>(sql`
    ${buildDeterministicMatchCte({ paymentId, tenantId })}
    select
      p.id as "paymentId",
      p.mode,
      p.tenant_id as "tenantId",
      p.customer_id as "customerId",
      p.subscription_id as "subscriptionId",
      p.mollie_payment_id as "molliePaymentId",
      p.paid_at as "paidAt",
      p.created_at as "paymentCreatedAt",
      p.amount_value::text as "amountValue",
      c.email as "customerEmail",
      case
        when cal.provider_customer_id ~ '^[0-9]+$'
          then cal.provider_customer_id::int
        else null
      end as "eboekhoudenRelationId",
      dm.first_payment_mode as "firstPaymentMode",
      dm.payment_link_id as "paymentLinkId",
      dm.consent_id as "consentId",
      dm.consent_accepted_at as "consentAcceptedAt",
      dm.plan_snapshot as "planSnapshot"
    from payments p
    inner join deterministic_matches dm on dm.payment_id = p.id
    left join customers c
      on c.id = p.customer_id
      and c.mode = p.mode
      and c.tenant_id = p.tenant_id
    left join customer_accounting_links cal
      on cal.customer_id = c.id
      and cal.tenant_id = c.tenant_id
      and cal.mode = c.mode
      and cal.provider = 'eboekhouden'
    where p.id = ${paymentId}
      and p.tenant_id = ${tenantId}
    limit 1
  `);

  return result.rows[0] ?? null;
}
