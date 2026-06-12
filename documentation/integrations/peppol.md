# Peppol Strategy

Status: future-facing reference
Audience: product and developers
Last verified: 2026-06-12

## Context

Peppol is a standardized network for exchanging structured business documents, especially e-invoices. The app should treat Peppol as a future delivery and compliance channel, not as core infrastructure to operate directly.

Current regulatory signals:

- Dutch suppliers to the central government already need e-invoicing support.
- EU ViDA makes structured e-invoicing and digital reporting mandatory for cross-border EU B2B transactions from 2030-07-01.
- The Netherlands is considering a domestic B2B e-invoicing mandate around 2030, likely Peppol-based, but this should not be treated as final law yet.
- Belgium moves earlier, with domestic B2B e-invoicing mandatory from 2026-01-01.

## Product Positioning

The commercial opportunity is not Peppol infrastructure itself. The opportunity is making compliance and invoice automation simple for SMEs, accountants, and businesses using Mollie-backed payment flows.

Best positioning:

- Peppol-ready invoice generation
- validation against EN 16931 / Peppol BIS Billing 3.0
- customer Peppol ID storage and lookup
- failed-delivery and missing-field alerts
- payment-link and reconciliation flows connected to Mollie
- accounting export and audit history

## Monetization Paths

### Peppol-ready invoicing

Add paid invoice quality and compliance features before Peppol sending is mandatory:

- structured invoice data checks
- Peppol XML generation
- validation errors surfaced to operators
- downloadable XML
- audit trail for invoice creation and delivery decisions

### Paid sending and receiving

Later, integrate with a certified Access Point provider and charge a markup or bundle allowance.

Possible pricing shape:

```text
Starter: included monthly Peppol invoice allowance
Pro: higher included allowance
Overage: per sent or received invoice
```

Keep provider cost separate internally so margins remain visible.

### Compliance subscription

Offer a recurring compliance add-on instead of relying only on transaction fees.

Possible package:

```text
Peppol Compliance Pack: EUR 9-29/month
```

Included value:

- Peppol invoice generation
- validation
- send and receive history
- customer Peppol lookup
- delivery failure alerts
- accountant export
- ongoing compliance updates

### Accountant tooling

Accountants and bookkeepers can be a distribution channel because they manage Peppol readiness for many clients.

Potential features:

- multi-company dashboard
- Peppol readiness checklist
- bulk customer Peppol ID checks
- invoice validation reports
- client onboarding status

Potential pricing:

```text
Accountant plan: EUR 49-199/month
Managed company add-on: EUR 2-10/month
```

### Mollie payment bridge

The most defensible app-specific angle is linking Peppol invoices to Mollie payment and reconciliation flows.

Example product promise:

```text
Send a compliant Peppol invoice with a Mollie payment link, then reconcile payment status automatically.
```

This is stronger than generic Peppol sending because it connects invoice delivery, payment collection, and operational follow-up.

### Belgium-first testing

Belgium's 2026 mandate can provide an earlier validation market before a Dutch domestic B2B mandate lands.

Possible angle:

- Dutch businesses invoicing Belgian customers
- Belgian SMEs needing lightweight Peppol support
- accountants with Belgian clients

## Implementation Direction

Do not become a Peppol Access Point early. That creates infrastructure, certification, and operational overhead before the product value is proven.

Preferred architecture:

1. Keep the internal invoice model compatible with EN 16931.
2. Generate Peppol BIS Billing 3.0 XML from internal invoice data.
3. Validate XML before delivery.
4. Hide delivery behind a provider interface, for example `InvoiceDeliveryProvider`.
5. Integrate one Access Point provider later.
6. Keep provider replacement possible.

## Risks

- Dutch domestic B2B timing may change before legislation is final.
- Access Point pricing and API terms vary significantly by provider.
- Some providers may not support the required white-label or multi-tenant model.
- Peppol invoice validity depends on clean customer, VAT, address, tax, and line-item data.
- Compliance value is low until operators understand the mandate or feel customer pressure.
