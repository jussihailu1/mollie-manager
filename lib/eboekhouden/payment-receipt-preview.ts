import type { EboekhoudenInvoice, EboekhoudenLedger } from "./client";
import { amountCents, assertInvoiceSalesMutation, resolveDebtorLedger, type SalesMutation } from "./invoice-posting";

type Money = { currency: string; value: string };
export type ReceiptPayment = {
  resource: string; id: string; mode: string; profileId: string; customerId?: string;
  subscriptionId?: string; sequenceType?: string; status: string; paidAt?: string;
  amount: Money; amountRefunded?: Money; amountRemaining?: Money; amountChargedBack?: Money;
  amountCaptured?: Money; _links: Record<string, unknown>;
};
export type ReceiptLink = {
  tenantId: string; mode: "live" | "test"; invoiceId: string; providerInvoiceId: string;
  invoiceNumber: string; relationId: number; paymentId: string; molliePaymentId: string;
  customerId: string; mollieCustomerId: string; mollieSubscriptionId?: string | null;
  ownerType: "payment" | "recurring_schedule"; ownerId: string; schedulePaymentId?: string | null;
  paymentType: string; status: string; paidAt: string; amount: Money;
  disputedAt?: string | null; collectionReviewRequiredAt?: string | null;
};
export type ReceiptOutstanding = {
  mutationId: number; invoiceNumber?: string; relationId?: number;
  totalAmount?: number; paidAmount?: number; outstandingAmount?: number;
};
export type ReceiptMutationInput = {
  type: 3; date: string; ledgerId: number; invoiceNumber: string; relationId: number;
  inExVat: "IN"; description: string; entryNumber: string;
  paymentReference: string; checkPaymentReference: true;
  rows: { amount: number; vatCode: "GEEN"; invoiceNumber: string; relationId: number; description: string }[];
};

function cents(money: Money | undefined) {
  if (!money || money.currency !== "EUR" || !/^\d+\.\d{2}$/.test(money.value)) throw Error("A complete EUR amount with exact cents is required.");
  const value = Number(money.value.replace(".", ""));
  if (!Number.isSafeInteger(value)) throw Error("Unsafe payment amount.");
  return value;
}

export function receiptPaymentDate(paidAt: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(paidAt) || !Number.isFinite(Date.parse(paidAt))) {
    throw Error("An explicit provider payment timestamp with timezone is required.");
  }
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(paidAt));
  const part = (name: string) => parts.find(value => value.type === name)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function receiptReference(paymentId: string) {
  if (!/^tr_[A-Za-z0-9]+$/.test(paymentId) || paymentId.length > 40) throw Error("Invalid stable Mollie payment identity.");
  return `KIFY-PAY-${paymentId}`;
}

export function assertPaymentReceipt(input: ReceiptMutationInput, mutation: SalesMutation, debtorId: number) {
  const row = mutation.rows?.[0];
  // The live API may omit the optional entry number for type-3 receipts. In
  // that case require the full stable payment identity in BOTH descriptions.
  const stableIdentity = mutation.entryNumber === input.entryNumber ||
    (!(mutation.entryNumber ?? "") && mutation.description === input.description && row?.description === input.rows[0].description);
  if (String(mutation.type) !== "3" || mutation.date !== input.date || mutation.ledgerId !== input.ledgerId ||
      !stableIdentity || mutation.invoiceNumber !== input.invoiceNumber ||
      mutation.relationId !== input.relationId || mutation.rows?.length !== 1 || !row ||
      row.ledgerId !== debtorId || row.invoiceNumber !== input.invoiceNumber || row.relationId !== input.relationId ||
      row.vatCode !== "GEEN" || amountCents(row.amount) !== amountCents(input.rows[0].amount) ||
      !["IN", "EX"].includes(mutation.inExVat ?? "")) {
    throw Error("Receipt differs from the payment, original invoice, clearing account, debtor or amount.");
  }
}

export function previewPaymentReceipt(input: {
  tenantId: string; mode: "live" | "test"; profileId: string; link: ReceiptLink; payment: ReceiptPayment;
  invoice: EboekhoudenInvoice; ledgers: EboekhoudenLedger[]; mutations: SalesMutation[];
  outstanding: ReceiptOutstanding[]; clearingLedgerId?: number; allLinks: ReceiptLink[];
}) {
  const { link, payment, invoice, ledgers, mutations } = input;
  const base = { invoiceNumber: link.invoiceNumber, molliePaymentId: link.molliePaymentId, originalInvoiceDate: invoice.date };
  const hold = (reason: string) => ({ ...base, status: "review_required" as const, reason, proposedMutation: null });
  try {
    if (link.tenantId !== input.tenantId || link.mode !== input.mode || payment.mode !== input.mode ||
        payment.profileId !== input.profileId || payment.resource !== "payment" || payment.id !== link.molliePaymentId ||
        !link.paymentId || !link.customerId || !link.mollieCustomerId || payment.customerId !== link.mollieCustomerId ||
        invoice.id !== Number(link.providerInvoiceId) || invoice.invoiceNumber !== link.invoiceNumber || invoice.relationId !== link.relationId) {
      return hold("Payment/invoice identity, customer, tenant, profile or mode differs.");
    }
    const ownedLinks = input.allLinks.filter(item => item.tenantId === input.tenantId && item.mode === input.mode);
    if (ownedLinks.filter(item => item.molliePaymentId === payment.id).length !== 1 ||
        ownedLinks.filter(item => item.providerInvoiceId === link.providerInvoiceId).length !== 1 ||
        ownedLinks.filter(item => item.invoiceId === link.invoiceId && item.paymentId === link.paymentId).length !== 1) {
      return hold("Payment or invoice has missing/ambiguous local ownership.");
    }
    if (link.ownerType === "payment") {
      if (link.ownerId !== link.paymentId || link.paymentType !== "first" || payment.sequenceType !== "first") return hold("First-payment ownership differs.");
    } else if (link.ownerType !== "recurring_schedule" || link.schedulePaymentId !== link.paymentId || link.paymentType !== "recurring" ||
        payment.sequenceType !== "recurring" || !link.mollieSubscriptionId || payment.subscriptionId !== link.mollieSubscriptionId) {
      return hold("Recurring payment is not bound to this schedule and subscription.");
    }
    if (payment.status !== "paid" || link.status !== "paid" || !payment.paidAt ||
        Date.parse(link.paidAt) !== Date.parse(payment.paidAt) || link.disputedAt || link.collectionReviewRequiredAt) return hold("Payment is unpaid, disputed or locally unresolved.");
    const grossCents = cents(payment.amount);
    if (grossCents <= 1 || grossCents !== cents(link.amount) || grossCents !== amountCents(invoice.totalAmount!)) return hold("Gross payment does not equal the invoice, or is a mandate-only cent.");
    // A paid status survives refunds/chargebacks. Presence of either link also
    // holds pending/reversed cases. Mollie omits amountChargedBack when zero.
    if (!payment._links || payment._links.refunds || payment._links.chargebacks || cents(payment.amountRefunded) !== 0 ||
        cents(payment.amountRemaining) !== grossCents ||
        (payment.amountChargedBack && cents(payment.amountChargedBack) !== 0) ||
        (payment.amountCaptured && cents(payment.amountCaptured) !== grossCents)) return hold("Refund, chargeback, partial capture or incomplete payment evidence requires review.");
    const date = receiptPaymentDate(payment.paidAt);
    const reference = receiptReference(payment.id);
    const debtor = resolveDebtorLedger(ledgers);
    const sales = mutations.filter(m => String(m.type) === "2" && m.invoiceNumber === invoice.invoiceNumber);
    if (sales.length !== 1) return hold("Exactly one original sales posting is required.");
    assertInvoiceSalesMutation(invoice, sales[0], ledgers);
    const clearing = ledgers.find(ledger => ledger.id === input.clearingLedgerId);
    if (input.clearingLedgerId !== undefined && (!clearing || clearing.category !== "FIN")) return hold("Selected clearing account must exist and have category FIN.");
    const expected = clearing ? {
      type: 3 as const, date, ledgerId: clearing.id, invoiceNumber: link.invoiceNumber, relationId: link.relationId,
      inExVat: "IN" as const, description: `Mollie ${payment.id}`, entryNumber: reference,
      paymentReference: reference, checkPaymentReference: true as const,
      rows: [{ amount: grossCents / 100, vatCode: "GEEN" as const, invoiceNumber: link.invoiceNumber, relationId: link.relationId, description: `Mollie ${payment.id}` }],
    } : null;
    const mentions = (value?: string) => !!value && [payment.id, reference, link.invoiceNumber].some(id => value.toLowerCase().includes(id.toLowerCase()));
    const belongsToAnotherOwnedPayment = (mutation: SalesMutation) => {
      if (!clearing || String(mutation.type) !== "3" || mutation.invoiceNumber === link.invoiceNumber) return false;
      const otherLinks = ownedLinks.filter(other => other.invoiceNumber === mutation.invoiceNumber &&
        other.invoiceId !== link.invoiceId && other.providerInvoiceId !== link.providerInvoiceId &&
        other.paymentId !== link.paymentId && other.molliePaymentId !== payment.id);
      if (otherLinks.length !== 1) return false;
      const other = otherLinks[0];
      if (!other.paymentId || ownedLinks.filter(item => item.molliePaymentId === other.molliePaymentId).length !== 1 ||
          ownedLinks.filter(item => item.providerInvoiceId === other.providerInvoiceId).length !== 1) return false;
      try {
        const otherReference = receiptReference(other.molliePaymentId);
        const description = `Mollie ${other.molliePaymentId}`;
        // Local paid_at is a stored timestamptz and may use PostgreSQL's space
        // separator. Normalize it before applying the same Amsterdam date rule.
        const otherExpected: ReceiptMutationInput = {
          type: 3, date: receiptPaymentDate(new Date(other.paidAt).toISOString()), ledgerId: clearing.id,
          invoiceNumber: other.invoiceNumber, relationId: other.relationId, inExVat: "IN", description,
          entryNumber: otherReference, paymentReference: otherReference, checkPaymentReference: true,
          rows: [{ amount: cents(other.amount) / 100, vatCode: "GEEN", invoiceNumber: other.invoiceNumber,
            relationId: other.relationId, description }],
        };
        assertPaymentReceipt(otherExpected, mutation, debtor.id);
        return true;
      } catch { return false; }
    };
    const relevant = mutations.filter(m => m.id !== sales[0].id && (
      [m.entryNumber, m.invoiceNumber, m.description].some(mentions) || m.rows?.some(r => mentions(r.invoiceNumber) || mentions(r.description)) ||
      (String(m.type) !== "2" && m.date === date && m.rows?.some(r => Math.abs(amountCents(r.amount)) === grossCents &&
        (m.relationId === link.relationId || r.relationId === link.relationId || r.ledgerId === debtor.id || r.ledgerId === clearing?.id)) &&
        !belongsToAnotherOwnedPayment(m))
    ));
    if (relevant.length) {
      if (expected && relevant.length === 1 && (relevant[0].entryNumber === reference || relevant[0].description === expected.description)) {
        assertPaymentReceipt(expected, relevant[0], debtor.id);
        return { ...base, paymentDate: date, amount: grossCents / 100, status: "already_posted" as const,
          reason: "One matching receipt with this stable payment identity already exists.", mutationId: relevant[0].id,
          expectedMutation: expected, proposedMutation: null };
      }
      return hold("Possible existing receipt, manual payment, reversal or correction; do not add another.");
    }
    const open = input.outstanding.filter(item => item.invoiceNumber === link.invoiceNumber || item.mutationId === sales[0].id);
    if (open.length !== 1 || open[0].mutationId !== sales[0].id || open[0].relationId !== link.relationId ||
        amountCents(open[0].totalAmount!) !== grossCents || amountCents(open[0].paidAmount!) !== 0 || amountCents(open[0].outstandingAmount!) !== grossCents) {
      return hold("Outstanding invoice is absent, partially paid, or differs from the full gross receipt.");
    }
    return { ...base, paymentDate: date, amount: grossCents / 100,
      status: expected ? "missing_receipt" as const : "clearing_account_required" as const,
      reason: expected ? "Verified gross receipt preview; fresh period, identity and duplicate checks required before any write." : "Payment and sale verified; choose a dedicated Mollie FIN clearing account.",
      expectedMutation: expected, proposedMutation: expected };
  } catch (error) { return hold(error instanceof Error ? error.message : "Receipt requires review."); }
}
