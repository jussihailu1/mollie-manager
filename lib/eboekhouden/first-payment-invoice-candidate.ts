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

export async function getFirstPaymentInvoiceCandidate(paymentId: string) {
  const result = await getDb().execute<FirstPaymentInvoiceCandidate>(sql`
    ${buildDeterministicMatchCte({ paymentId })}
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
      c.eboekhouden_relation_id as "eboekhoudenRelationId",
      dm.first_payment_mode as "firstPaymentMode",
      dm.payment_link_id as "paymentLinkId",
      dm.consent_id as "consentId",
      dm.consent_accepted_at as "consentAcceptedAt",
      dm.plan_snapshot as "planSnapshot"
    from payments p
    inner join deterministic_matches dm on dm.payment_id = p.id
    left join customers c on c.id = p.customer_id and c.mode = p.mode
    where p.id = ${paymentId}
    limit 1
  `);

  return result.rows[0] ?? null;
}
