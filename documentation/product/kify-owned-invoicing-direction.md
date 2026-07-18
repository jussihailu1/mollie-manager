# Kify-Owned Invoicing Direction

Status: accepted product direction; implementation deferred until Mollie Connect closes
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

## First Implementation Milestone After Connect

Implement a Kify-native invoice provider behind the existing provider-neutral
invoice boundary:

1. create tenant-owned invoice records and a compliant rendered document;
2. keep app-owned email delivery, resend, download, idempotency, retry, and
   audit evidence intact;
3. attach Mollie payment links or payment state without making Mollie the
   invoice issuer;
4. keep existing Mollie/e-Boekhouden invoices owned by their original provider;
5. make e-Boekhouden export/synchronization optional and explicitly
   tenant-scoped;
6. remove Mollie Invoicing from normal onboarding/readiness only after live
   proof of the Kify-native path.

This is a product and architecture change, not a copy-only change. It starts
only after the Mollie Connect completion gate unless the roadmap is explicitly
reprioritized.
