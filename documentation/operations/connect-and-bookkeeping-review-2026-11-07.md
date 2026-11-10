# Connect And Bookkeeping Review — 7 November 2026

Status: dated findings; optional consent and invoice-posting fix implemented locally; production correction outstanding
Audience: product, engineering and platform operators

## Continuation — 8 November 2026

The paid PSPbetalingen connector review is complete. It imports customer payments,
not Mollie fees or payouts, and Kify's recorded payment descriptions/metadata lack
per-invoice matching references. The account has native Mollie payment links and
one API token named Mollie Manager; no separate import connector was evidenced,
and the user knows of no provider account. No connector was activated or purchased.

The user authorized the local invoice-posting fix and a read-only repair preview.
The client now requests the sales mutation alongside new invoice creation and
issuance/recovery verifies it. A fresh complete-history scan found eight candidate
repairs totaling EUR 164.83 and two date discrepancies totaling EUR 44.89. All ten
still lack matching sales entries. See [the detailed preview](eboekhouden-sales-posting-preview-2026-11-08.md).

Keep the optional-consent code intact but defer migration/deployment/reauthorization:
it is not required for sales plus gross-receipt posting with manual monthly
Mollie-statement reconciliation. Customer-payment code remains outstanding.
No financial entry, deployment, invoice resend, account setting or JHS relationship
changed. The dated original findings below remain historical evidence.

## Continuation — Optional Consent Implemented Locally

The user deferred the JHS relationship and authorized work on optional Mollie
bookkeeping access. Settings now offers a separate consent upgrade that preserves
the connected organization/profile and keeps bookkeeping permissions out of
payment validation. Its callback verifies the candidate identity before saving;
bounded balances, settlements and fee-invoice GETs determine data-access readiness.
Cancellation, identity mismatch, missing scopes and concurrent connection changes
have focused runtime tests. This is access preparation, not accounting sync.

Migration `0030_mollie_bookkeeping_consent` is prepared but unapplied. No deployment,
live authorization, provider configuration change or financial write was performed.
The verified production findings below remain dated evidence. See the
[contract](../integrations/mollie-connect-contract.md) for the local implementation
and [live proof](mollie-connect-live-proof.md) for remaining acceptance steps.

## Scope And Evidence

The user prioritized understanding bookkeeping and Connect ownership before
fixing the integration, then requested durable documentation and review of next
steps. This pass does not change financial entries, connections, credentials,
payouts, partner relationships or deployments.

Evidence: production PostgreSQL read-only transactions, e-Boekhouden API GETs
after session authentication, the signed-in Mollie dashboard, current source,
and three GETs using Ayal Web's existing unexpired OAuth token. No token refresh
was invoked by the review. Private inspection evidence remains outside Git:

- `C:\Users\Jussi\Kify-Recovery\2026-11-07-connect-review`
- `C:\Users\Jussi\Kify-Recovery\2026-11-07-bookkeeping-review`

Do not commit credentials, raw API responses or customer records from those
directories. Observations are dated snapshots, not continuing monitoring.

## Confirmed Connect State

The [accepted ownership model](../integrations/mollie-account-ownership.md)
records the identity mapping. Kify's app is owned by J Hailu Solutions; Ayal Web
uses that organization's Ayal Web profile through OAuth. Direct OAuth reads of
the organization, profile and an existing paid live payment returned 200 with
matching identities. The retained API key is not the normal runtime choice.

JHS remains a separate active Mollie partner client, linked 18 July 2026. The
October cleanup completion record confirms 380 local rows removed, 33 retained
tables unchanged and `mollieAccountChanged: false`. Current tenant-scoped rows
belong only to Ayal Web. No JHS provider-side revocation or deletion was done.

This narrows earlier unknowns about Ayal Web's own OAuth connection. It does not
close the full M6 live proof or prove onboarding another independent merchant.

## Confirmed Bookkeeping Gaps

- Ayal Web uses e-Boekhouden issuance, KOR / `GEEN`, and app SMTP delivery.
- Ten Kify-linked live invoices exist in the e-Boekhouden invoice module,
  totaling EUR 209.72. None has a matching sales-invoice mutation in the complete
  2026 API result of 74 bookkeeping entries. None appears in the outstanding
  debtor list; that absence is not proof of payment when the sale is unposted.
- Revenue ledger 8010 has balance zero. Kify labels it "Omzet abonnementen";
  e-Boekhouden names the same ledger "Omzet groep 2".
- Kify's invoice payload omits `mutation`. The current official OpenAPI says
  supplying that object also processes the invoice as a bookkeeping mutation.
- No dedicated Mollie balance account exists in the 44 returned ledger accounts.
  No Kify implementation posts customer-payment mutations, fee invoices or
  payouts. The only explicit Mollie reference found in the 2026 entry details
  was a EUR 0.01 bank-verification expense. Unprocessed bank imports and external
  connector configuration were not inspected.

Invoice creation/reconciliation in Kify is therefore not evidence of completed
accounting posting or matching of payments to invoices in e-Boekhouden.

## Mollie Financial Snapshot

| Item | Observed value |
| --- | --- |
| Total / available / pending balance | EUR 165.61 / 141.14 / 24.47 |
| Payout mode | Manual; automatic payouts paused |
| Reserve / minimum payout | EUR 100 / 5 |
| Selected bank | Knab ending 9078 |
| Dashboard estimated future payouts | EUR 65.61 |
| Historical payout | EUR 19.71 on 15 April 2026 |
| April–October fee invoices | All seven paid; total EUR 4.11; zero outstanding |

A EUR 19.99 recurring payment shows a EUR 0.43 deduction and EUR 19.56 net.
The 6 November EUR 0.01 mandate payment shows a EUR 0.39 deduction and EUR -0.38
net. Monthly invoice-compensation credits are present. These observations do
not constitute a completed ledger reconciliation.

## Next Work And Acceptance Gates

The roadmap authorizes the review sequence below; external changes and financial
corrections need their own concrete scope. Keep K7/K8 and the M6 proof gates open.

1. **JHS external relationship review.** Confirm the exact organization and
   remaining app authorization, establish the effect of Mollie's "End
   partnership", then present the bounded action. Partnership termination is
   not account closure or historical financial-record deletion. Verify the
   provider result separately if the user requests the change.
   Mollie's [merchant-management guide](https://docs.mollie.com/docs/connect-manage-merchants)
   confirms Partners > Clients removal is a disconnection method. The observed
   target is J Housing Services `org_19570291`, not the app-owning J Hailu
   Solutions organization `org_19456510`. No disconnection has been performed.
2. **Merchant onboarding and permission design.** Preserve one platform app and
   tenant-specific merchant grants. Specify duplicate-organization handling,
   separate payment/payout/accounting readiness, optional bookkeeping scopes
   and reauthorization behavior. Validate two-tenant isolation and the M6 flow;
   do not claim this from Ayal Web's successful GETs alone.
3. **Bookkeeping correction design.** First make future invoice issuance post
   the sale exactly once. Prepare a report/dry-run for existing invoices after
   reconciling prior manual corrections; do not recreate or resend them. Define
   debtor, revenue, Mollie clearing, fee and bank mappings.
4. **Payment, fee and payout reconciliation.** Match full gross receipts to
   customer invoices; reconcile deductions and monthly fee invoices without
   duplicate expense recognition; book payouts as transfers, not new revenue.
   Include rounding, pending funds, refunds/reversals and the mandate cent.
   Evaluate the existing e-Boekhouden PSP connector against Kify's references
   and recurring flows before deciding to implement all of this ourselves.
   Exactly one integration must own each accounting write.
5. **Legacy-key retirement.** Inventory runtime, scripts and external consumers;
   close the migration proof/exception gate before removal or revocation.

Success means every relevant invoice, payment, fee and payout is explainable
against the provider statements and ledger, with duplicate prevention and
tenant isolation. It is not just a matching net bank deposit.

References: [e-Boekhouden OpenAPI](https://api.e-boekhouden.nl/openapi/v1.json),
[Mollie bookkeeping](https://help.mollie.com/hc/nl/articles/115002098309-Hoe-verwerk-ik-Mollie-transacties-in-mijn-boekhoudpakket),
[existing PSP connector](https://www.e-boekhouden.nl/koppelingen/payment-service-providers/mollie).
