# Kify-Owned Invoicing Direction

Status: accepted product direction; explicitly promoted to active implementation
Audience: product and engineering

## Decision

Invoicing supports Kify's automatic-incasso workflow. The
[roadmap](implementation-roadmap.md#product-end-goal) defines the product goal;
this document only defines invoice ownership and integration boundaries.

Kify must not make a tenant's ability to create and deliver invoices depend on
Mollie Invoicing activation, a first live transaction, or a Mollie commercial
approval decision.

The target model is:

- Kify is the default issuer for invoices created by new tenants and owns invoice creation, the rendered document, customer delivery, resend,
  download, and invoice history.
- Mollie Connect owns payment collection, payment links, customers, mandates,
  subscriptions, and authoritative payment state.
- e-Boekhouden is an optional, tenant-scoped issuer choice only after that tenant
  supplies valid credentials and completes its template and ledger setup.
- Mollie Sales Invoices is an optional later integration, never the default
  invoice path or a tenant onboarding gate.

This lets a tenant issue an invoice before its first Mollie transaction. Mollie
payment-method and account approval can still control whether the tenant can
collect a payment; Kify must state that separately from invoice readiness.

Provider selection affects only new invoices. Existing invoice ownership and
documents never change. The provider interface remains the extension point for
future bookkeeping providers; there is no global credential fallback.

## Why

Mollie Invoicing is a provider-controlled product activation. Its availability
cannot be guaranteed by Kify, and its account/setup flow can be completed only
by the tenant with Mollie. Making it the default invoice provider creates an
external onboarding blocker for a core Kify workflow.

## Current State And Boundary

K1–K6 are implemented: Kify invoice snapshots, PDFKit rendering, private Blob
artifacts, first-payment/recurring issuance, delivery and tenant-fenced document
access exist. Kify is the default for new tenants; K7 controlled live proof and
K8 plan retirement remain open. Code completion does not close those gates.

Existing Mollie and e-Boekhouden invoices retain their provider adapters. Only
tenants actively using legacy Mollie issuance require its Sales Invoices probe;
Kify invoice readiness is separate from Mollie payment readiness. Optional
e-Boekhouden synchronization for Kify-issued invoices is still missing. The
new receipt branch handles e-Boekhouden-issued invoices only and is not yet
activated. See the feature inventory and receipt automation runbook for evidence.

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
