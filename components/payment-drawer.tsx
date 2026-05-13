"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  ExternalLink,
  LoaderCircle,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatCurrency, formatDateTime, formatLabel } from "@/lib/format";
import type { PaymentDrawerData } from "@/lib/payment-details";
import { cn } from "@/lib/utils";

type PaymentRecord = {
  customerBusinessName: string;
  customerId: string | null;
  id: string;
  molliePaymentId: string | null;
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
      href={`/customers?focus=${encodeURIComponent(customerId)}`}
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

function renderUnknownValue(value: unknown): React.ReactNode {
  if (value == null) {
    return <span className="text-muted-foreground">-</span>;
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="text-muted-foreground">-</span>;
    }

    return (
      <div className="space-y-2 text-left">
        {value.map((item, index) => (
          <div key={index} className="rounded-md border p-2">
            {renderUnknownValue(item)}
          </div>
        ))}
      </div>
    );
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);

    if (entries.length === 0) {
      return <span className="text-muted-foreground">-</span>;
    }

    return (
      <div className="space-y-2 text-left">
        {entries.map(([key, entryValue]) => (
          <div
            key={key}
            className="flex flex-col gap-1 border-b border-border/60 pb-2 last:border-b-0 last:pb-0 sm:flex-row sm:justify-between sm:gap-4"
          >
            <span className="text-muted-foreground">{formatLabel(key)}</span>
            <span className="break-words sm:max-w-[58%] sm:text-right">
              {renderUnknownValue(entryValue)}
            </span>
          </div>
        ))}
      </div>
    );
  }

  return String(value);
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
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  );
}

export function PaymentDrawer({
  onOpenChange,
  open,
  payment,
}: Readonly<{
  onOpenChange: (open: boolean) => void;
  open: boolean;
  payment: PaymentRecord | null;
}>) {
  const [details, setDetails] = useState<PaymentDrawerData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showMore, setShowMore] = useState(false);

  useEffect(() => {
    if (!open || !payment) {
      return;
    }

    setShowMore(false);

    let active = true;
    const params = new URLSearchParams();
    params.set("paymentId", payment.id);

    if (payment.molliePaymentId) {
      params.set("molliePaymentId", payment.molliePaymentId);
    }

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/payments/mollie?${params.toString()}`, {
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => null)) as
          | PaymentDrawerData
          | { error?: string }
          | null;

        if (!response.ok) {
          throw new Error(
            payload && "error" in payload && typeof payload.error === "string"
              ? payload.error
              : "Failed to load payment details.",
          );
        }

        if (active) {
          setDetails(payload as PaymentDrawerData);
        }
      } catch (fetchError) {
        if (active) {
          setDetails(null);
          setError(
            fetchError instanceof Error
              ? fetchError.message
              : "Failed to load payment details.",
          );
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      active = false;
    };
  }, [open, payment]);

  const drawerTitle = details?.molliePaymentId ?? payment?.reference ?? "Payment details";
  const mollieDashboardUrl = details?.payment.links.dashboard ?? null;

  const linkEntries = useMemo(
    () => Object.entries(details?.payment.links ?? {}),
    [details?.payment.links],
  );

  if (!payment) {
    return null;
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto px-6 sm:max-w-md">
        <SheetHeader className="pb-6">
          <div className="min-w-0">
            <SheetTitle className="truncate text-2xl">{drawerTitle}</SheetTitle>
            <SheetDescription className="mt-2">
              <CustomerLink
                customerId={details?.customerId ?? payment.customerId}
                customerName={details?.customerName ?? payment.customerBusinessName}
                className="text-sm"
              />
            </SheetDescription>
          </div>
        </SheetHeader>

        <div className="space-y-8">
          <Section title="Overview">
            <ValueRow
              label="Payment ID"
              value={
                <div className="flex items-center justify-end gap-1">
                  <span className="font-mono text-xs">{drawerTitle}</span>
                  {mollieDashboardUrl ? (
                    <Button asChild variant="ghost" size="icon-xs">
                      <a
                        href={mollieDashboardUrl}
                        target="_blank"
                        rel="noreferrer"
                        aria-label="Open payment in Mollie"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </Button>
                  ) : null}
                </div>
              }
            />
            <ValueRow
              label="Status"
              value={<Badge variant="default">{formatLabel(details?.payment.status ?? payment.status)}</Badge>}
            />
            <ValueRow
              label="Amount"
              value={<AmountValue amount={details?.payment.amount ?? null} />}
            />
            <ValueRow
              label="Description"
              value={details?.payment.description ?? <span className="text-muted-foreground">-</span>}
            />
            <ValueRow
              label="Method"
              value={details?.payment.method ? formatLabel(details.payment.method) : "-"}
            />
            <ValueRow
              label="Sequence Type"
              value={details?.payment.sequenceType ? formatLabel(details.payment.sequenceType) : "-"}
            />
            <ValueRow
              label="Created At"
              value={details?.payment.createdAt ? formatDateTime(details.payment.createdAt) : "-"}
            />
            <ValueRow
              label="Paid At"
              value={details?.payment.paidAt ? formatDateTime(details.payment.paidAt) : "-"}
            />
          </Section>

          {loading ? (
            <div className="flex items-center gap-2 rounded-md border p-4 text-sm text-muted-foreground">
              <LoaderCircle className="h-4 w-4 animate-spin" />
              Loading live Mollie payment data...
            </div>
          ) : null}

          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Could not load payment details</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {details ? (
            <>
              <button
                type="button"
                className="text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
                onClick={() => setShowMore((current) => !current)}
              >
                {showMore ? "hide" : "show more"}
              </button>
              {showMore ? (
                <div className="space-y-8">
                  <Section title="Timing and status">
                    <ValueRow
                      label="Status Reason"
                      value={
                        details.payment.statusReason
                          ? `${details.payment.statusReason.code}: ${details.payment.statusReason.message}`
                          : "-"
                      }
                    />
                    <ValueRow
                      label="Authorized At"
                      value={
                        details.payment.authorizedAt
                          ? formatDateTime(details.payment.authorizedAt)
                          : "-"
                      }
                    />
                    <ValueRow
                      label="Canceled At"
                      value={
                        details.payment.canceledAt
                          ? formatDateTime(details.payment.canceledAt)
                          : "-"
                      }
                    />
                    <ValueRow
                      label="Failed At"
                      value={details.payment.failedAt ? formatDateTime(details.payment.failedAt) : "-"}
                    />
                    <ValueRow
                      label="Expired At"
                      value={details.payment.expiresAt ? formatDateTime(details.payment.expiresAt) : "-"}
                    />
                    <ValueRow
                      label="Is Cancelable"
                      value={
                        details.payment.isCancelable == null
                          ? "-"
                          : details.payment.isCancelable
                            ? "Yes"
                            : "No"
                      }
                    />
                  </Section>

                  <Separator />

                  <Section title="Relations">
                    <ValueRow label="Customer ID" value={details.payment.customerId ?? "-"} />
                    <ValueRow label="Subscription ID" value={details.payment.subscriptionId ?? "-"} />
                    <ValueRow label="Mandate ID" value={details.payment.mandateId ?? "-"} />
                    <ValueRow label="Order ID" value={details.payment.orderId ?? "-"} />
                    <ValueRow label="Profile ID" value={details.payment.profileId ?? "-"} />
                  </Section>

                  <Separator />

                  <Section title="Amounts">
                    <ValueRow label="Settlement Amount" value={<AmountValue amount={details.payment.settlementAmount} />} />
                    <ValueRow label="Settlement ID" value={details.payment.settlementId ?? "-"} />
                    <ValueRow label="Amount Refunded" value={<AmountValue amount={details.payment.amountRefunded} />} />
                    <ValueRow label="Amount Remaining" value={<AmountValue amount={details.payment.amountRemaining} />} />
                    <ValueRow label="Amount Captured" value={<AmountValue amount={details.payment.amountCaptured} />} />
                    <ValueRow label="Amount Charged Back" value={<AmountValue amount={details.payment.amountChargedBack} />} />
                    <ValueRow label="Application Fee" value={renderUnknownValue(details.payment.applicationFee)} />
                  </Section>

                  <Separator />

                  <Section title="Configuration">
                    <ValueRow label="Locale" value={details.payment.locale ?? "-"} />
                    <ValueRow label="Country Code" value={details.payment.countryCode ?? "-"} />
                    <ValueRow label="Issuer" value={details.payment.issuer ?? "-"} />
                    <ValueRow
                      label="Restrict Payment Methods To Country"
                      value={details.payment.restrictPaymentMethodsToCountry ?? "-"}
                    />
                    <ValueRow label="Capture Mode" value={details.payment.captureMode ?? "-"} />
                    <ValueRow label="Capture Delay" value={details.payment.captureDelay ?? "-"} />
                    <ValueRow
                      label="Capture Before"
                      value={
                        details.payment.captureBefore
                          ? formatDateTime(details.payment.captureBefore)
                          : "-"
                      }
                    />
                  </Section>

                  <Separator />

                  <Section title="URLs">
                    <ValueRow label="Redirect URL" value={renderUnknownValue(details.payment.redirectUrl)} />
                    <ValueRow label="Cancel URL" value={renderUnknownValue(details.payment.cancelUrl)} />
                    <ValueRow label="Webhook URL" value={renderUnknownValue(details.payment.webhookUrl)} />
                  </Section>

                  {linkEntries.length > 0 ? (
                    <>
                      <Separator />
                      <Section title="Links">
                        {linkEntries.map(([key, href]) => (
                          <ValueRow
                            key={key}
                            label={formatLabel(key)}
                            value={
                              <a
                                href={href}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 hover:underline"
                              >
                                <span className="break-all">{href}</span>
                                <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                              </a>
                            }
                          />
                        ))}
                      </Section>
                    </>
                  ) : null}

                  {details.payment.details ? (
                    <>
                      <Separator />
                      <Section title="Details">
                        <div className="text-sm">{renderUnknownValue(details.payment.details)}</div>
                      </Section>
                    </>
                  ) : null}

                  {details.payment.metadata ? (
                    <>
                      <Separator />
                      <Section title="Metadata">
                        <div className="text-sm">{renderUnknownValue(details.payment.metadata)}</div>
                      </Section>
                    </>
                  ) : null}

                  {details.payment.routing ? (
                    <>
                      <Separator />
                      <Section title="Routing">
                        <div className="text-sm">{renderUnknownValue(details.payment.routing)}</div>
                      </Section>
                    </>
                  ) : null}

                  {details.payment.lines ? (
                    <>
                      <Separator />
                      <Section title="Lines">
                        <div className="text-sm">{renderUnknownValue(details.payment.lines)}</div>
                      </Section>
                    </>
                  ) : null}

                  {details.payment.billingAddress ? (
                    <>
                      <Separator />
                      <Section title="Billing Address">
                        <div className="text-sm">{renderUnknownValue(details.payment.billingAddress)}</div>
                      </Section>
                    </>
                  ) : null}

                  {details.payment.shippingAddress ? (
                    <>
                      <Separator />
                      <Section title="Shipping Address">
                        <div className="text-sm">{renderUnknownValue(details.payment.shippingAddress)}</div>
                      </Section>
                    </>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
