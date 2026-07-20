# Kify-Owned Invoicing Direction

Status: accepted product direction; explicitly promoted to active implementation
Audience: product and engineering

## Decision

Kify must not make a tenant's ability to create and deliver invoices depend on
Mollie Invoicing activation, a first live transaction, or a Mollie commercial
approval decision.

The target model is:

- Kify owns invoice creation, the rendered document, customer delivery, resend,
  download, and invoice history.
- Mollie Connect owns payment collection, payment links, customers, mandates,
  subscriptions, and authoritative payment state.
- e-Boekhouden is an optional tenant accounting integration, not a prerequisite
  for issuing a Kify invoice.
- Mollie Sales Invoices is an optional later integration, never the default
  invoice path or a tenant onboarding gate.

This lets a tenant issue an invoice before its first Mollie transaction. Mollie
payment-method and account approval can still control whether the tenant can
collect a payment; Kify must state that separately from invoice readiness.

## Why

Mollie Invoicing is a provider-controlled product activation. Its availability
cannot be guaranteed by Kify, and its account/setup flow can be completed only
by the tenant with Mollie. Making it the default invoice provider creates an
external onboarding blocker for a core Kify workflow.

## Current State And Boundary

Current code still has Mollie and e-Boekhouden invoice-provider adapters. When
Mollie is active, it probes the Sales Invoices API and warns until that Mollie
product is activated. That behavior remains truthful until the target model is
implemented; it is not a workaround for the external gate.

Do not remove the current probe or claim that Kify-owned invoices exist before
the replacement has safely preserved invoice ownership, customer delivery,
idempotency, retry, reconciliation, and tenant isolation.

The implementation roadmap now records Mollie Connect M6 live proof as an
external blocker and explicitly promotes Kify-owned invoicing. This is a
sequencing decision only: Kify-owned issuance remains missing until implemented
and proven.

## Active Implementation Decision

Implement Kify-owned invoicing through the detailed contract in
[`kify-owned-invoicing-implementation-plan.md`](./kify-owned-invoicing-implementation-plan.md):

1. create tenant-owned canonical invoice records and a compliant rendered PDF;
2. use a provider-neutral `InvoiceDocumentRenderer` with native PDFKit as the
   first production renderer;
3. keep artifact storage behind `InvoiceArtifactStore`, with Vercel Private Blob
   as the first backend;
4. route Kify and legacy documents through `InvoiceDocumentService`;
5. keep app-owned email delivery, resend, download, idempotency, retry, and
   audit evidence intact;
6. attach Mollie payment links or payment state without making Mollie the
   invoice issuer;
7. keep existing Mollie/e-Boekhouden invoices owned by their original provider;
8. make e-Boekhouden export/synchronization optional and explicitly
   tenant-scoped;
9. remove Mollie Invoicing from normal onboarding/readiness only after live
   proof of the Kify-native path.

Invoice-Generator.com is not part of the first implementation. It may be added
later only as another renderer behind the same boundary and only after a
separate commercial, privacy, quota, failure-semantics, and live-proof milestone.

The initial implementation is limited to automated real-installment
first-payment and recurring invoices. Manual invoices, accounting export,
UBL/Peppol, mixed VAT, discounts, credit notes, and PDF/A certification remain
out of scope.
