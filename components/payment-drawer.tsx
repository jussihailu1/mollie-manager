"use client";

import Link from "next/link";
import { useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  LoaderCircle,
  ExternalLink,
  Download,
  ChevronRight,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  REPAIR_STALE_AFTER_MS,
  isOlderThan,
} from "@/lib/freshness";
import { formatCurrency, formatDateTime, formatLabel } from "@/lib/format";
import { buildDrawerPath } from "@/lib/dashboard-drawer-route";
import type { PaymentDrawerData } from "@/lib/payment-details";
import { getPaymentNotices, invoiceStatusLabels } from "@/lib/payment-drawer-presentation";
import { cn } from "@/lib/utils";
import { useAsyncResource, useJsonResource } from "@/lib/use-async-resource";
import { repairPayment } from "@/lib/payment-repair-request";

type PaymentRecord = {
  amount: string;
  currency: string;
  description: string;
  createdAt: string;
  paidAt: string | null;
  type: "first" | "recurring";
  customerBusinessName: string;
  customerId: string | null;
  id: string;
  molliePaymentId: string | null;
  lastSyncedAt: string | null;
  reference: string;
  status: "pending" | "paid" | "failed" | "expired";
};

function CustomerLink({
  customerId,
  customerName,
  className,
}: Readonly<{
  className?: string;
  customerId: string | null;
  customerName: string | null;
}>) {
  const label = customerName ?? "Unknown customer";

  if (!customerId) {
    return <span className={className}>{label}</span>;
  }

  return (
    <Link
      href={buildDrawerPath("customers", customerId)}
      className={cn(
        "group inline-flex items-center gap-1 hover:underline",
        className,
      )}
    >
      <span>{label}</span>
      <ArrowUpRight className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
    </Link>
  );
}

function ValueRow({
  label,
  value,
}: Readonly<{
  label: string;
  value: React.ReactNode;
}>) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium text-foreground sm:max-w-[58%] sm:text-right break-words">
        {value}
      </dd>
    </div>
  );
}

function AmountValue({
  amount,
}: Readonly<{
  amount: { currency: string; value: string } | null;
}>) {
  if (!amount) {
    return <span className="text-muted-foreground">-</span>;
  }

  return formatCurrency(amount.value, amount.currency);
}

function Section({
  children,
  title,
}: Readonly<{
  children: React.ReactNode;
  title: string;
}>) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      <dl className="flex flex-col gap-3">{children}</dl>
    </div>
  );
}

function formatInvoiceTriggerKind(
  value: PaymentDrawerData["invoice"]["triggerKind"],
) {
  switch (value) {
    case "automation":
      return "Automation";
    case "manual":
      return "Manual";
    case "recovered_existing":
      return "Recovered existing";
    default:
      return "Unknown";
  }
}

function formatInvoiceOwnerType(
  value: PaymentDrawerData["invoice"]["ownerType"],
) {
  return value === "recurring_schedule" ? "Recurring schedule" : "Payment row";
}

function formatInvoiceAttachmentStatus(
  value: PaymentDrawerData["invoice"]["documentAttachmentStatus"],
) {
  switch (value) {
    case "attached":
      return "Attached to the email.";
    case "download_failed":
      return "Email sent without attachment because the PDF download failed.";
    case "invalid_content_type":
      return "Email sent without attachment because the upstream file was not a PDF.";
    case "invalid_pdf":
      return "Email sent without attachment because the downloaded file was not a valid PDF.";
    case "missing_url":
      return "Email sent without attachment because no invoice document URL was available.";
    case "timeout":
      return "Email sent without attachment because the PDF download timed out.";
    case "too_large":
      return "Email sent without attachment because the PDF exceeded the size limit.";
    case "untrusted_url":
      return "Email sent without attachment because the upstream document URL was not trusted.";
    default:
      return "-";
  }
}

function shouldAutoRepairPayment(
  payment: PaymentRecord,
  details: PaymentDrawerData | null,
) {
  if (!payment.molliePaymentId) {
    return false;
  }

  if (isOlderThan(payment.lastSyncedAt, REPAIR_STALE_AFTER_MS)) {
    return true;
  }

  return details?.invoiceState === "invoice_failed";
}

type PaymentDrawerProps = Readonly<{
  onOpenChange: (open: boolean) => void;
  open: boolean;
  payment: PaymentRecord | null;
}>;

export function PaymentDrawer(props: PaymentDrawerProps) {
  if (!props.open || !props.payment) return null;
  return <PaymentDrawerSession key={props.payment.id} {...props} />;
}

function PaymentDrawerSession({
  onOpenChange,
  open,
  payment,
}: PaymentDrawerProps) {
  const router = useRouter();
  const paymentId = payment?.id ?? null;
  const lastSyncedAt = payment?.lastSyncedAt ?? null;
  const molliePaymentId = payment?.molliePaymentId ?? null;
  const params = new URLSearchParams();
  if (paymentId) params.set("paymentId", paymentId);
  if (molliePaymentId) params.set("molliePaymentId", molliePaymentId);
  // A refreshed server payment snapshot also invalidates invoice details, which
  // can change without advancing the provider's lastSyncedAt timestamp.
  const { data: details, error, loading } = useJsonResource<PaymentDrawerData>(
    paymentId ? "/api/payments/mollie?" + params.toString() : null,
    "Failed to load payment details.", payment,
  );
  // Resolve details first so unknown -> invoice_failed cannot submit two repairs.
  const needsRepair = !loading && !!payment && shouldAutoRepairPayment(payment, details);
  const fingerprint = (lastSyncedAt ?? "never") + ":" + (details?.invoiceState ?? "unknown");
  const loadRepair = useCallback(
    () => repairPayment(paymentId!, fingerprint),
    [paymentId, fingerprint],
  );
  const { data: repairResult, error: repairError, loading: isRepairing } = useAsyncResource(
    needsRepair ? loadRepair : null,
  );
  useEffect(() => {
    if (repairResult?.status === "repaired") router.refresh();
  }, [repairResult, router]);

  if (!payment) return null;

  const status = details?.payment.status ?? payment.status;
  const amount = details?.payment.amount ?? { value: payment.amount, currency: payment.currency };
  const description = details?.payment.description || payment.description;
  const paidAt = details ? details.payment.paidAt : payment.paidAt;
  const mollieDashboardUrl = details?.payment.links.dashboard ?? null;
  const invoiceDownloadUrl = details?.invoice.invoicePdfUrl ?? details?.invoicePdfUrl ?? null;
  const invoice = details?.invoice;
  const notices = getPaymentNotices(details, payment.status);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto px-6 pb-8 sm:max-w-md">
        <SheetHeader className="pb-6 pr-6 text-left">
          <SheetTitle className="text-2xl">Payment details</SheetTitle>
          <SheetDescription>
            <CustomerLink
              customerId={details?.customerId ?? payment.customerId}
              customerName={details?.customerName ?? payment.customerBusinessName}
              className="break-words"
            />
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6">
          <div className="space-y-2 rounded-lg border bg-muted/30 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-3xl font-semibold tracking-tight">
                <AmountValue amount={amount} />
              </p>
              <Badge variant={status === "paid" ? "default" : ["failed", "expired", "canceled"].includes(status) ? "destructive" : "secondary"}>
                {formatLabel(status)}
              </Badge>
            </div>
            {description ? <p className="break-words text-sm text-muted-foreground">{description}</p> : null}
          </div>

          {loading || isRepairing ? (
            <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
              <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
              {loading ? "Checking payment and invoice details..." : "Updating payment and invoice status..."}
            </p>
          ) : null}
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Could not load the latest details</AlertTitle>
              <AlertDescription>
                Showing saved payment information. Close and reopen this payment to try again.
              </AlertDescription>
            </Alert>
          ) : null}
          {repairError ? (
            <Alert variant="destructive">
              <AlertTitle>Could not update this payment</AlertTitle>
              <AlertDescription>
                The information shown may be out of date. Check the payment in Mollie or try again later.
              </AlertDescription>
            </Alert>
          ) : null}

          {notices.length > 0 ? (
            <div className="space-y-3" aria-label="Payment and invoice updates">
              {notices.map((notice) => (
                <Alert key={notice.id} variant={notice.urgent ? "destructive" : "default"} role={notice.urgent ? "alert" : "status"}>
                  <AlertTitle>{notice.title}</AlertTitle>
                  <AlertDescription>{notice.message}</AlertDescription>
                </Alert>
              ))}
            </div>
          ) : null}

          <Section title="Payment">
            {details?.payment.method ? <ValueRow label="Method" value={formatLabel(details.payment.method)} /> : null}
            <ValueRow label="Type" value={
              details?.payment.sequenceType === "oneoff" ? "One-off payment" :
              (details?.payment.sequenceType ?? payment.type) === "recurring" ? "Recurring payment" : "First payment"
            } />
            <ValueRow label="Created" value={formatDateTime(details?.payment.createdAt ?? payment.createdAt)} />
            {paidAt ? <ValueRow label="Paid" value={formatDateTime(paidAt)} /> : null}
            {details?.payment.failedAt ? <ValueRow label="Failed" value={formatDateTime(details.payment.failedAt)} /> : null}
            {details?.payment.canceledAt ? <ValueRow label="Canceled" value={formatDateTime(details.payment.canceledAt)} /> : null}
            {details?.payment.expiredAt ? <ValueRow label="Expired" value={formatDateTime(details.payment.expiredAt)} /> : null}
          </Section>

          <div className="space-y-4 border-t pt-6">
            <Section title="Invoice">
              <ValueRow label="Status" value={invoice ? invoiceStatusLabels[invoice.state] : loading ? "Checking..." : "Unavailable"} />
              {invoice?.invoiceNumber ? <ValueRow label="Number" value={invoice.invoiceNumber} /> : null}
              {invoice?.createdAt ? <ValueRow label="Created" value={formatDateTime(invoice.createdAt)} /> : null}
              {invoice?.sentAt ? <ValueRow label="Sent" value={formatDateTime(invoice.sentAt)} /> : null}
              {invoice?.deliveryRecipient ? <ValueRow label="Recipient" value={invoice.deliveryRecipient} /> : null}
            </Section>
            {invoiceDownloadUrl ? (
              <Button asChild className="w-full">
                <a href={invoiceDownloadUrl} target="_blank" rel="noreferrer">
                  <Download className="h-4 w-4" />
                  Download invoice
                </a>
              </Button>
            ) : invoice && ["invoice_created", "invoice_sent"].includes(invoice.state) ? (
              <p className="text-sm text-muted-foreground">The invoice exists, but its PDF is not available here yet.</p>
            ) : null}
          </div>

          {mollieDashboardUrl ? (
            <Button asChild variant="outline" className="w-full">
              <a href={mollieDashboardUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4" />
                Open payment in Mollie
              </a>
            </Button>
          ) : null}

          <details className="group border-t pt-4">
            <summary className="flex cursor-pointer list-none items-center justify-between rounded-sm py-2 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
              Technical details
              <ChevronRight className="h-4 w-4 transition-transform group-open:rotate-90" aria-hidden="true" />
            </summary>
            <div className="space-y-6 pt-4">
              <Section title="References">
                <ValueRow label="Payment ID" value={details?.molliePaymentId ?? payment.molliePaymentId ?? payment.reference} />
                <ValueRow label="Local ID" value={payment.id} />
                <ValueRow label="Last synced" value={formatDateTime(details?.lastSyncedAt ?? payment.lastSyncedAt)} />
                {details?.payment.mode ? <ValueRow label="Mode" value={formatLabel(details.payment.mode)} /> : null}
                {details?.payment.customerId ? <ValueRow label="Customer ID" value={details.payment.customerId} /> : null}
                {details?.payment.subscriptionId ? <ValueRow label="Subscription ID" value={details.payment.subscriptionId} /> : null}
                {details?.payment.mandateId ? <ValueRow label="Mandate ID" value={details.payment.mandateId} /> : null}
                {details?.payment.profileId ? <ValueRow label="Profile ID" value={details.payment.profileId} /> : null}
                {details?.payment.statusReason ? <ValueRow label="Status reason code" value={details.payment.statusReason.code} /> : null}
                {error ? <ValueRow label="Loading error" value={error} /> : null}
                {repairError ? <ValueRow label="Update error" value={repairError} /> : null}
              </Section>
              {details ? (
                <>
                  <Section title="Invoice processing">
                    <ValueRow label="Stored on" value={formatInvoiceOwnerType(details.invoice.ownerType)} />
                    <ValueRow label="Trigger" value={formatInvoiceTriggerKind(details.invoice.triggerKind)} />
                    {details.invoice.source ? <ValueRow label="Source" value={formatLabel(details.invoice.source)} /> : null}
                    {details.invoice.documentAttachmentStatus ? <ValueRow label="Attachment Delivery" value={formatInvoiceAttachmentStatus(details.invoice.documentAttachmentStatus)} /> : null}
                    {details.invoice.intendedRecipient ? <ValueRow label="Intended recipient" value={details.invoice.intendedRecipient} /> : null}
                    <ValueRow label="Recipient overridden" value={details.invoice.recipientOverridden ? "Yes" : "No"} />
                    {details.invoice.createdByActorEmail || details.invoice.createdByActorKind ? (
                      <ValueRow label="Created by" value={details.invoice.createdByActorEmail ?? formatLabel(details.invoice.createdByActorKind)} />
                    ) : null}
                  </Section>
                  <Section title="Processing">
                    {details.payment.settlementAmount ? <ValueRow label="Settlement amount" value={<AmountValue amount={details.payment.settlementAmount} />} /> : null}
                    {details.payment.settlementId ? <ValueRow label="Settlement ID" value={details.payment.settlementId} /> : null}
                    {details.payment.amountCaptured ? <ValueRow label="Captured" value={<AmountValue amount={details.payment.amountCaptured} />} /> : null}
                    {details.payment.amountRemaining ? <ValueRow label="Remaining" value={<AmountValue amount={details.payment.amountRemaining} />} /> : null}
                    {details.payment.authorizedAt ? <ValueRow label="Authorized" value={formatDateTime(details.payment.authorizedAt)} /> : null}
                    {details.payment.expiresAt ? <ValueRow label="Expires" value={formatDateTime(details.payment.expiresAt)} /> : null}
                    <ValueRow label="Webhook Callback" value={details.payment.webhookUrlStatus === "hidden" ? "Configured in Mollie and hidden in this UI." : "Not configured"} />
                  </Section>
                </>
              ) : null}
            </div>
          </details>
        </div>
      </SheetContent>
    </Sheet>
  );
}
