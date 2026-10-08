# e-Boekhouden invoice verification and recovery

## Normal sequence

Kify claims one payment or recurring schedule, searches e-Boekhouden for its deterministic reference, then creates an invoice only when the search completes without a match. The request supplies the agreed price with `inExVat: IN` and the selected tax code (`GEEN` for KOR, `HOOG_VERK_21` for the supported standard flow). e-Boekhouden calculates the invoice. Kify checks it through a fresh GET: expected invoice identity/relation/reference, total and VAT. It stores the verified invoice with `apiVerification` evidence containing the expected amount, applied tax treatment and verification time.

Before each delivery attempt, Kify repeats the API identity/total/VAT checks using that frozen issuance evidence, then downloads the PDF URL returned for that invoice. Download, trusted-host/redirect, size, content-type and PDF-signature checks remain required. It does **not** parse PDF text or require an identical file hash. A missing or invalid PDF leaves the invoice recorded as created and triggers the existing delivery retry/alert flow; it must not cause another invoice POST. An old invoice without verified issuance evidence requires review before delivery, rather than inferring its treatment from today's tenant setting. The four historical incorrect invoices require their separate correction process.

## PDF setup and change check

Visually inspect an actual rendered provider PDF at initial setup, after changing the selected template or editing that template in e-Boekhouden, and after changing tax treatment. Confirm the invoice number, correct issuer/customer, final amount, VAT, and KOR notice where applicable. Also inspect the PDF when investigating a specific document complaint or correcting an invoice.

Record tenant, template ID, tax treatment, sample invoice number, review date, reviewer and outcome with the release/operator evidence. Before first rollout, use one controlled legitimate invoice and inspect its PDF before customer delivery; do not create a fictitious live invoice for testing. Saving settings does not perform this review, and Kify does not detect external template edits. This checkpoint is an operator procedure, not a new automatic settings gate.

Normal issuance attempts delivery immediately. Agree a controlled review/delivery procedure before creating the first sample (for example, an explicitly approved operator recipient for that bounded check); simply calling the normal create flow does not pause for visual review.

The concrete PDF-specific risk is a template omitting the KOR notice or displaying incorrect text despite correct API data. No provider/API-to-PDF mismatch has been demonstrated in this incident. Automatic text parsing is layout-dependent and cannot prove arbitrary visual correctness; a different hash can also represent a semantically unchanged regenerated document. These checks therefore do not block routine delivery. Revisit a targeted safeguard if a reproducible provider/document defect is found.

Kify snapshots the tenant tax treatment when it claims the invoice row, so later recovery uses the treatment that applied to that issuance attempt. Older failed rows without a snapshot use the tenant's current setting and need operator review if the treatment changed meanwhile.

Before the POST, Kify can validate the tenant's KOR choice, template, ledger, relation, exact two-decimal subscription amount, deterministic reference, and whether a matching invoice already exists. e-Boekhouden's calculated total, VAT and assigned identity are checked after creation. The template's visual review is a separate setup/change procedure.

## If verification fails after the POST

The invoice already exists in e-Boekhouden. Kify leaves the owner in `invoice_failed`, with no Kify invoice record and no customer invoice email. The owner metadata records `invoiceCreationManualReview`, the upstream invoice ID/number/reference, and the error. A warning or critical alert is opened. Neither the normal create job nor the safe retry queue creates a second invoice from this state. The failed-invoice recovery job searches by reference and rechecks API identity, total and VAT before linking the invoice. An ambiguous search or failed API check keeps the row failed and customer delivery blocked. PDF availability is handled later as a delivery issue.

The creation claim itself also rejects `invoiceCreationManualReview`, even if another path has changed the row to `pending_invoice`. Generic provider retries and the standalone safe-requeue script preserve this hold. The standalone script checks the canonical `invoices` table rather than removed legacy invoice columns; it rechecks the hold and stored-invoice guards during its update.

If the process stops after the e-Boekhouden POST but before the failure handler, the row can remain `invoice_creating`. Do not reset it to `pending_invoice` until the upstream reference has been inspected. Treat it as a manual recovery case.

## Operator steps

1. Open the Kify alert. Record the tenant, mode, payment/schedule ID, upstream invoice ID, reference, and verification error. Inspect the actual e-Boekhouden invoice and PDF. Confirm whether any earlier customer delivery occurred outside Kify.
2. If e-Boekhouden permits a lawful correction to the **same** invoice, make it there. The next failed-invoice recovery pass will verify it again and send only after it passes. The invoice number, total, VAT, and KOR notice must all be correct.
3. If the issued invoice must be credited, issue and verify the credit note in e-Boekhouden, then create a replacement invoice there. Use a distinct upstream invoice ID. Run the explicit replacement recovery command below without `--apply` to verify the replacement's API identity, amount and VAT. Review the output, actual PDF and credit note yourself. Then rerun with `--apply` to link the replacement in Kify and attempt customer delivery. The command requires the original invoice ID stored on the failed row and records the credit note number. It does not create an invoice or credit note, parse a PDF or prove a visual review occurred. It only handles failed attempts, not corrections to successfully recorded/sent historical invoices.
4. Check Kify's owner state, stored invoice, audit log, and delivery result. If delivery fails, use the existing delivery retry/alert flow. Re-running the replacement command cannot link or send the invoice a second time once the owner has left `invoice_failed`.

```powershell
node --conditions=react-server --import tsx scripts/recover-credited-eboekhouden-invoice.ts `
  --tenant-id <tenant-uuid> --mode live `
  --owner-type recurring_schedule --owner-id <schedule-uuid> `
  --operator-email <operator-email> `
  --credited-invoice-id <original-id> --replacement-invoice-id <replacement-id> `
  --credit-note-number <credit-note-number>

# Only after the dry run and credit note are checked:
node --conditions=react-server --import tsx scripts/recover-credited-eboekhouden-invoice.ts `
  --tenant-id <tenant-uuid> --mode live `
  --owner-type recurring_schedule --owner-id <schedule-uuid> `
  --operator-email <operator-email> `
  --credited-invoice-id <original-id> --replacement-invoice-id <replacement-id> `
  --credit-note-number <credit-note-number> --apply
```

For a first-payment invoice, use `--owner-type payment` and the payment ID. Use `--mode test` for test rows. The dry run reads e-Boekhouden and Kify but changes neither. The apply step requires the operator's confirmation that the original was credited; the e-Boekhouden API check does not independently prove the credit note exists.
