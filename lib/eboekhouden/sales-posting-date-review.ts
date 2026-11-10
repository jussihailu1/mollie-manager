import { z } from "zod";
import type { EboekhoudenInvoice } from "@/lib/eboekhouden/client";
import type { LocalPostingInvoice } from "@/lib/eboekhouden/sales-posting-preview";

const date = z.iso.date();
const text = z.string().trim().min(1);
const dateReviewSchema = z.object({
  localInvoiceId: text,
  providerInvoiceId: z.string().regex(/^[1-9]\d*$/),
  invoiceNumber: text,
  relationId: z.number().int().positive(),
  reference: text.max(50),
  amountValue: z.string().regex(/^\d+\.\d{2}$/),
  currency: z.literal("EUR"),
  scheduledInvoiceDate: date,
  originalInvoiceDate: date,
  termOfPayment: z.number().int().nonnegative(),
  collectionDate: date,
  evidence: z.array(z.object({
    source: text,
    sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  }).strict()).min(1),
  reason: text,
}).strict().refine(review => {
  const due = new Date(`${review.originalInvoiceDate}T00:00:00.000Z`);
  due.setUTCDate(due.getUTCDate() + review.termOfPayment);
  return Number.isFinite(due.getTime()) && due.toISOString().slice(0, 10) === review.collectionDate;
}, "Original payment term must reconcile to the reviewed collection date.");

const manifestSchema = z.object({
  version: z.literal(1),
  purpose: z.literal("read-only-sales-posting-preview"),
  tenantId: z.uuid(),
  mode: z.enum(["live", "test"]),
  reviewedAt: z.iso.datetime(),
  reviews: z.array(dateReviewSchema).min(1),
}).strict();

export type InvoiceDateReview = z.infer<typeof dateReviewSchema>;

// This is evidence for a preview, never authority to change a document or post.
export function parseInvoiceDateReviews(value: unknown, scope: { tenantId: string; mode: string }) {
  const parsed = manifestSchema.safeParse(value);
  if (!parsed.success) throw new Error("Invalid reviewed-date manifest; check its schema, dates and payment terms.");
  const manifest = parsed.data;
  if (manifest.tenantId !== scope.tenantId || manifest.mode !== scope.mode) {
    throw new Error("Reviewed-date manifest does not match the requested tenant and mode.");
  }
  for (const key of ["localInvoiceId", "providerInvoiceId", "invoiceNumber"] as const) {
    if (new Set(manifest.reviews.map(review => review[key])).size !== manifest.reviews.length) {
      throw new Error(`Reviewed-date manifest contains duplicate ${key} values.`);
    }
  }
  return manifest;
}

export function invoiceDateReviewMatches(review: InvoiceDateReview, local: LocalPostingInvoice, invoice: EboekhoudenInvoice) {
  return review.localInvoiceId === local.localInvoiceId &&
    review.providerInvoiceId === local.providerInvoiceId && Number(review.providerInvoiceId) === invoice.id &&
    review.invoiceNumber === local.invoiceNumber && review.invoiceNumber === invoice.invoiceNumber &&
    review.relationId === local.relationId && review.relationId === invoice.relationId &&
    review.reference === local.reference && review.reference === invoice.reference &&
    review.amountValue === local.amountValue && Number(review.amountValue) === invoice.totalAmount &&
    review.currency === local.currency &&
    review.scheduledInvoiceDate === local.invoiceDate && review.originalInvoiceDate === invoice.date &&
    review.termOfPayment === invoice.termOfPayment;
}
