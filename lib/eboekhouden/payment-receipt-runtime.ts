import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { getTenantMollieClient, getTenantMollieRequestContext } from "@/lib/mollie/client";
import { getEboekhoudenInvoice, getEboekhoudenMutation, listEboekhoudenLedgers,
  listEboekhoudenMutations, listEboekhoudenOutstanding } from "./client";
import { readAllEboekhoudenPages } from "./pagination";
import { receiptPaymentDate, type ReceiptLink, type ReceiptPayment } from "./payment-receipt-preview";
import type { ReceiptSettings, ReceiptScope } from "./payment-receipt-contract";
import type { ReceiptContext } from "./payment-receipt-workflow";

export async function listReceiptLinks(scope: ReceiptScope): Promise<ReceiptLink[]> {
  if (!scope.tenantId || scope.mode !== "live") throw new Error("Live tenant context required");
  const result = await getDb().execute<ReceiptLink>(sql`
    select i.id as "invoiceId", i.provider_invoice_id as "providerInvoiceId", i.provider_invoice_number as "invoiceNumber",
      i.tenant_id as "tenantId", i.mode, i.owner_type as "ownerType", i.owner_id as "ownerId",
      p.id as "paymentId", p.mollie_payment_id as "molliePaymentId", p.customer_id as "customerId",
      c.mollie_customer_id as "mollieCustomerId", s.mollie_subscription_id as "mollieSubscriptionId",
      r.payment_id as "schedulePaymentId", p.payment_type as "paymentType", p.mollie_status as status,
      p.paid_at::text as "paidAt", p.disputed_at::text as "disputedAt",
      p.collection_review_required_at::text as "collectionReviewRequiredAt",
      jsonb_build_object('value', p.amount_value::text, 'currency', p.amount_currency) as amount,
      case when cal.link_status = 'linked' and (i.provider_customer_id is null or i.provider_customer_id = cal.provider_customer_id)
        then cal.provider_customer_id::integer else 0 end as "relationId"
    from invoices i
    left join recurring_billing_schedules r on i.owner_type = 'recurring_schedule' and r.id = i.owner_id
      and r.tenant_id = i.tenant_id and r.mode = i.mode
    join payments p on p.id = case when i.owner_type = 'payment' then i.owner_id else r.payment_id end
      and p.tenant_id = i.tenant_id and p.mode = i.mode
    join customers c on c.id = p.customer_id and c.tenant_id = i.tenant_id and c.mode = i.mode
    left join subscriptions s on s.id = coalesce(p.subscription_id, r.subscription_id)
      and s.tenant_id = i.tenant_id and s.mode = i.mode and s.customer_id = p.customer_id
    left join customer_accounting_links cal on cal.customer_id = p.customer_id
      and cal.tenant_id = i.tenant_id and cal.mode = i.mode and cal.provider = 'eboekhouden'
    where i.tenant_id = ${scope.tenantId} and i.mode = ${scope.mode} and i.provider = 'eboekhouden'
      and i.voided_at is null and (i.owner_type = 'payment' or r.subscription_id = p.subscription_id)
    order by p.paid_at desc nulls last, i.id
  `);
  return result.rows;
}

export async function listUnverifiedReceiptPaymentIds(scope: ReceiptScope) {
  if (!scope.tenantId || scope.mode !== "live") throw new Error("Live tenant context required");
  const result = await getDb().execute<{ paymentId: string; status: string }>(sql`
    select payment_id as "paymentId", status from eboekhouden_payment_receipts
    where tenant_id = ${scope.tenantId} and mode = ${scope.mode}
  `);
  return result.rows;
}

export async function loadReceiptContext(settings: ReceiptSettings, paymentId: string): Promise<ReceiptContext> {
  const allLinks = await listReceiptLinks(settings);
  const links = allLinks.filter(link => link.paymentId === paymentId);
  if (links.length !== 1) throw new Error("Missing or ambiguous payment ownership");
  const link = links[0];
  const invoiceId = Number(link.providerInvoiceId);
  if (!/^\d+$/.test(link.providerInvoiceId) || !Number.isSafeInteger(invoiceId) || invoiceId <= 0) throw new Error("Invoice identity required");
  const [client, requestContext] = await Promise.all([
    getTenantMollieClient(settings.tenantId, "live"), getTenantMollieRequestContext(settings.tenantId, "live"),
  ]);
  if (requestContext.testmode || (requestContext.profileId && requestContext.profileId !== settings.profileId)) {
    throw new Error("Mollie profile changed");
  }
  const payment = await client.payments.get(link.molliePaymentId) as unknown as ReceiptPayment;
  const date = receiptPaymentDate(payment.paidAt ?? "");
  const tenantId = settings.tenantId;
  // Invoice/reference matching covers receipts on any date. The payment-date
  // query also finds unreferenced/manual rows requiring review. Never filter by
  // receipt type or by outstanding invoices: paid entries must remain visible.
  const indexLists = await Promise.all([
    { invoiceNumber: link.invoiceNumber }, { description: `%${link.molliePaymentId}%` }, { date },
  ].map(filter => readAllEboekhoudenPages((limit, offset) =>
    listEboekhoudenMutations({ ...filter, tenantId, limit, offset }))));
  const ids = [...new Set(indexLists.flat().map(item => item.id))];
  const mutations = [];
  for (const id of ids) {
    const mutation = await getEboekhoudenMutation(id, tenantId);
    if (mutation.id !== id) throw new Error("Mutation identity changed");
    mutations.push(mutation);
  }
  const [invoice, ledgers, outstanding] = await Promise.all([
    getEboekhoudenInvoice(invoiceId, tenantId),
    readAllEboekhoudenPages((limit, offset) => listEboekhoudenLedgers({ tenantId, limit, offset })),
    readAllEboekhoudenPages((limit, offset) => listEboekhoudenOutstanding({ tenantId, invoiceNumber: link.invoiceNumber, limit, offset })),
  ]);
  if (invoice.id !== invoiceId) throw new Error("Invoice identity changed");
  return { link, allLinks, payment, invoice, ledgers, mutations, outstanding };
}
