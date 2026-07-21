import "server-only";

import { sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { buildCanonicalKifyInvoice } from "@/lib/invoicing/canonical-invoice";
import { createKifyInvoiceIssuer } from "@/lib/invoicing/kify-invoice-issuer";
import { claimKifyInvoice, completeKifyInvoice, failKifyInvoice } from "@/lib/invoicing/kify-invoice-persistence";
import { nativePdfKitInvoiceRenderer } from "@/lib/invoicing/native-pdf-renderer";
import { vercelBlobInvoiceArtifactStore } from "@/lib/invoicing/vercel-blob-artifact-store";

function cents(value: string) {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) throw new Error("Kify source amount must be a positive EUR amount with at most two decimals.");
  const result = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  if (!Number.isSafeInteger(result) || result <= 0) throw new Error("Kify source amount must be positive.");
  return result;
}

export async function issueKifyInvoice(input: {
  amountValue: string; customerId: string; description: string; dueDate: string; invoiceDate: string;
  mode: "live" | "test"; ownerId: string; ownerType: "payment" | "recurring_schedule";
  paymentContext: { kind: "paid_first_installment"; molliePaymentId?: string } | { kind: "scheduled_collection"; plannedCollectionDate: string };
  tenantId: string;
}) {
  const profiles = await getDb().execute<{
    customerCity: string; customerCountryCode: string; customerEmail: string; customerHouseNumber: string; customerLegalName: string; customerPostalCode: string; customerStreet: string;
    invoiceEmail: string; invoicePrefix: string; issuerCity: string; issuerCountryCode: string; issuerHouseNumber: string; issuerLegalName: string; issuerPostalCode: string; issuerStreet: string; issuerVatId: string;
  }>(sql`
    select cbp.legal_name as "customerLegalName", cbp.street as "customerStreet", cbp.house_number as "customerHouseNumber", cbp.postal_code as "customerPostalCode", cbp.city as "customerCity", cbp.country_code as "customerCountryCode", cbp.email as "customerEmail",
      tip.legal_name as "issuerLegalName", tip.street as "issuerStreet", tip.house_number as "issuerHouseNumber", tip.postal_code as "issuerPostalCode", tip.city as "issuerCity", tip.country_code as "issuerCountryCode", tip.vat_id as "issuerVatId", tip.invoice_email as "invoiceEmail", tip.invoice_prefix as "invoicePrefix"
    from tenant_invoice_profiles tip inner join customer_billing_profiles cbp on cbp.tenant_id = tip.tenant_id and cbp.customer_id = ${input.customerId}
    where tip.tenant_id = ${input.tenantId} limit 1
  `);
  const profile = profiles.rows[0];
  if (!profile) throw new Error("Kify tenant or customer invoice profile is incomplete.");
  const grossCents = cents(input.amountValue);
  const canonical = buildCanonicalKifyInvoice({ lines: [{ currency: "EUR", description: input.description, grossCents, quantity: 1, vatRateBasisPoints: 2100 }], sourceAmountCents: grossCents });
  const issuer = createKifyInvoiceIssuer({
    artifactStore: vercelBlobInvoiceArtifactStore,
    renderer: nativePdfKitInvoiceRenderer,
    claim: ({ ownerId, ownerType, tenantId }) => claimKifyInvoice({ mode: input.mode, ownerId, ownerType, prefix: profile.invoicePrefix, tenantId, year: Number(input.invoiceDate.slice(0, 4)), buildSnapshot: ({ invoiceId, invoiceNumber }) => ({ amountPaidCents: input.paymentContext.kind === "paid_first_installment" ? canonical.totalCents : 0, balanceCents: input.paymentContext.kind === "paid_first_installment" ? 0 : canonical.totalCents, currency: "EUR", dueDate: input.dueDate, invoiceDate: input.invoiceDate, invoiceId, invoiceNumber, issuer: { city: profile.issuerCity, countryCode: profile.issuerCountryCode, email: profile.invoiceEmail, legalName: profile.issuerLegalName, postalCode: profile.issuerPostalCode, streetAddress: `${profile.issuerStreet} ${profile.issuerHouseNumber}`, vatId: profile.issuerVatId }, lines: canonical.lines.map((line) => ({ ...line })), mode: input.mode, paymentContext: input.paymentContext, recipient: { city: profile.customerCity, countryCode: profile.customerCountryCode, email: profile.customerEmail, legalName: profile.customerLegalName, postalCode: profile.customerPostalCode, streetAddress: `${profile.customerStreet} ${profile.customerHouseNumber}` }, schemaVersion: 1, subtotalCents: canonical.subtotalCents, tenantId, totalCents: canonical.totalCents, vatCents: canonical.vatCents }) }),
    complete: (result) => completeKifyInvoice({ ...result, tenantId: input.tenantId }),
    fail: (result) => failKifyInvoice({ ...result, tenantId: input.tenantId }),
  });
  return issuer.issue({ ownerId: input.ownerId, ownerType: input.ownerType, tenantId: input.tenantId });
}
