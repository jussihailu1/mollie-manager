"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Archive,
  Check,
  CheckCircle,
  Copy,
  ExternalLink,
  FileText,
  Link as LinkIcon,
  Mail,
  MapPin,
  PenLine,
  Phone,
  Plus,
  LoaderCircle,
  Repeat,
  RotateCcw,
  Search,
  User,
} from "lucide-react";

import {
  createCustomerAction,
  createFirstPaymentAction,
  createSubscriptionAction,
  linkEboekhoudenRelationAction,
  syncCustomerBillingStateAction,
} from "@/lib/onboarding/actions";
import { buildConsentLinkReturnTo } from "@/lib/onboarding/consent-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import {
  REPAIR_RETRY_AFTER_MS,
  REPAIR_STALE_AFTER_MS,
  isOlderThan,
} from "@/lib/freshness";
import {
  deriveCustomerLifecycleState,
  type CustomerLifecycleStateResult,
} from "@/lib/customer-lifecycle-state";
import { formatCurrency, formatDate, formatDateTime, formatLabel } from "@/lib/format";
import {
  hasMeaningfulDifference,
  relationFieldLabels,
  relationFieldNames,
  type LocalRelationFields,
} from "@/lib/eboekhouden/relation-mapping";

const renewableLinkStatuses = new Set(["archived", "canceled", "expired", "failed"]);

export type CustomerFlowRecord = {
  address: string | null;
  businessName: string | null;
  contactName: string | null;
  createdAt: string;
  archivedAt: string | null;
  eboekhoudenLinkStatus: "linked" | "unlinked" | "needs_review" | "sync_error";
  eboekhoudenRelationCode: string | null;
  eboekhoudenRelationId: number | null;
  eboekhoudenSyncedAt: string | null;
  email: string;
  hasValidMandate: boolean;
  id: string;
  mollieCustomerId: string | null;
  latestPaymentAmountCurrency: string | null;
  latestPaymentAmountValue: string | null;
  latestPaymentCreatedAt: string | null;
  latestPaymentId: string | null;
  latestPaymentPaidAt: string | null;
  latestPaymentStatus: "pending" | "paid" | "failed" | "expired" | null;
  latestPaymentType: "first" | "recurring" | null;
  latestFirstPaymentCheckoutUrl: string | null;
  latestFirstPaymentLinkStatus: string | null;
  latestFirstPaymentLinkUrl: string | null;
  latestConsentAcceptedAt: string | null;
  latestFirstPaymentMode: "real_installment" | "mandate_only" | null;
  latestFirstPaymentPaidAt: string | null;
  latestFirstPaymentStatus: string | null;
  latestMandateStatus: string | null;
  latestSubscriptionAmountCurrency: string | null;
  latestSubscriptionAmountValue: string | null;
  latestSubscriptionCancellationEffect: "immediate" | "end_of_paid_period" | null;
  latestSubscriptionDescription: string | null;
  latestSubscriptionId: string | null;
  latestSubscriptionInterval: string | null;
  latestSubscriptionLastChargeDate: string | null;
  latestSubscriptionMollieStatus: string | null;
  latestSubscriptionNextPaymentDate: string | null;
  latestSubscriptionServiceEndAt: string | null;
  latestSubscriptionStartDate: string | null;
  latestSubscriptionStatus: string | null;
  latestSubscriptionStopAfterCurrentPeriod: boolean | null;
  latestSubscriptionTermMode: "open_ended" | "fixed_term" | null;
  latestSubscriptionTotalPayments: number | null;
  lastSyncedAt: string | null;
  mode: "live" | "test";
  notes: string | null;
  phone: string | null;
  subscriptionCount: number;
};

type EboekhoudenRelationListItem = {
  code: string;
  id: number;
  localFields: LocalRelationFields | null;
  name: string;
  type: string;
};

type EboekhoudenRelationDetail = {
  localFields: LocalRelationFields;
  relation: {
    code?: string | null;
    id: number;
    name?: string | null;
    type?: string | null;
  };
};

type CustomerBillingHistory = {
  mandates: {
    createdAt: string;
    id: string;
    isValid: boolean;
    method: string | null;
    mollieMandateId: string;
    mollieStatus: string | null;
  }[];
  payments: {
    amountCurrency: string;
    amountValue: string;
    createdAt: string;
    failedAt: string | null;
    id: string;
    method: string | null;
    molliePaymentId: string | null;
    mollieStatus: string | null;
    paidAt: string | null;
    paymentType: string;
  }[];
  subscriptions: {
    amountCurrency: string;
    amountValue: string;
    createdAt: string;
    description: string;
    id: string;
    interval: string;
    lastChargeDate: string | null;
    localStatus: string;
    mollieStatus: string | null;
    nextPaymentDate: string | null;
  }[];
};

type CustomerActivityTimeline = {
  items: {
    entityId: string;
    entityType: string;
    href: string;
    id: string;
    itemType: string;
    occurredAt: string;
    severity: "critical" | "info" | "warning";
    summary: string;
    title: string;
  }[];
};

export type CustomerStage =
  | "new"
  | "payment_pending"
  | "payment_completed"
  | "subscription_activation_pending"
  | "subscription_active";

type CustomerActionKind =
  | "create_payment"
  | "confirm_payment"
  | "activation_pending"
  | "create_subscription"
  | "active";

export function getEboekhoudenStatusBadge(customer: CustomerFlowRecord) {
  switch (customer.eboekhoudenLinkStatus) {
    case "linked":
      return (
        <Badge variant="secondary">
          <LinkIcon className="mr-1 h-3 w-3" />
          e-Boekhouden
        </Badge>
      );
    case "needs_review":
      return (
        <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100/80">
          Needs review
        </Badge>
      );
    case "sync_error":
      return <Badge variant="destructive">Sync error</Badge>;
    default:
      return (
        <Badge variant="outline" className="border-yellow-300 text-yellow-700">
          <AlertTriangle className="mr-1 h-3 w-3" />
          Unlinked
        </Badge>
      );
  }
}

function getCustomerActionKind(customer: CustomerFlowRecord): CustomerActionKind {
  const stage = getCustomerStage(customer);

  if (stage === "subscription_active") {
    return "active";
  }

  if (stage === "subscription_activation_pending") {
    return "activation_pending";
  }

  if (stage === "payment_completed") {
    return "create_subscription";
  }

  if (stage === "payment_pending") {
    return "confirm_payment";
  }

  return "create_payment";
}

function formatSubscriptionInterval(value: string | null) {
  switch (value) {
    case "weekly":
    case "1 week":
      return "Weekly";
    case "monthly":
    case "1 month":
      return "Monthly";
    case "yearly":
    case "12 months":
      return "Yearly";
    default:
      return formatLabel(value);
  }
}

function formatPaymentType(type: CustomerFlowRecord["latestPaymentType"]) {
  if (type === "first") {
    return "First payment";
  }

  if (type === "recurring") {
    return "Recurring payment";
  }

  return "Not available";
}

function formatFirstPaymentMode(mode: CustomerFlowRecord["latestFirstPaymentMode"]) {
  if (mode === "real_installment") {
    return "Real first installment";
  }

  if (mode === "mandate_only") {
    return "Mandate-only (€0.01)";
  }

  return "Not available";
}

function getPaymentStatusBadge(status: CustomerFlowRecord["latestPaymentStatus"]) {
  switch (status) {
    case "pending":
      return (
        <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100/80">
          Pending
        </Badge>
      );
    case "paid":
      return <Badge variant="default">Paid</Badge>;
    case "failed":
      return <Badge variant="destructive">Failed</Badge>;
    case "expired":
      return <Badge variant="outline">Expired</Badge>;
    default:
      return <Badge variant="outline">Unknown</Badge>;
  }
}

function formatHistoryPaymentType(type: string | null) {
  return type === "first" || type === "recurring" ? formatPaymentType(type) : formatLabel(type);
}

function getHistoryPaymentStatusBadge(status: string | null) {
  switch (status) {
    case "pending":
      return (
        <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100/80">
          Pending
        </Badge>
      );
    case "paid":
      return <Badge variant="default">Paid</Badge>;
    case "failed":
      return <Badge variant="destructive">Failed</Badge>;
    case "expired":
      return <Badge variant="outline">Expired</Badge>;
    default:
      return <Badge variant="outline">{formatLabel(status)}</Badge>;
  }
}

function getTimelineSeverityBadge(severity: CustomerActivityTimeline["items"][number]["severity"]) {
  switch (severity) {
    case "critical":
      return <Badge variant="destructive">Critical</Badge>;
    case "warning":
      return (
        <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100/80">
          Warning
        </Badge>
      );
    default:
      return <Badge variant="secondary">Info</Badge>;
  }
}

function getSubscriptionStatusBadge(status: CustomerFlowRecord["latestSubscriptionStatus"]) {
  if (status === "active") {
    return <Badge variant="default">Active</Badge>;
  }

  if (status === "payment_action_required" || status === "out_of_sync") {
    return <Badge variant="destructive">{formatLabel(status)}</Badge>;
  }

  if (status === "future_charges_stopped") {
    return <Badge variant="secondary">Stopping</Badge>;
  }

  return <Badge variant="outline">{formatLabel(status)}</Badge>;
}

export function getCustomerLifecycleState(
  customer: CustomerFlowRecord,
): CustomerLifecycleStateResult {
  return deriveCustomerLifecycleState({
    archivedAt: customer.archivedAt,
    eboekhoudenLinkStatus: customer.eboekhoudenLinkStatus,
    hasValidMandate: customer.hasValidMandate,
    latestConsentAcceptedAt: customer.latestConsentAcceptedAt,
    latestFirstPaymentStatus: customer.latestFirstPaymentStatus,
    latestPaymentStatus: customer.latestPaymentStatus,
    latestPaymentType: customer.latestPaymentType,
    latestSubscriptionMollieStatus: customer.latestSubscriptionMollieStatus,
    latestSubscriptionServiceEndAt: customer.latestSubscriptionServiceEndAt,
    latestSubscriptionStatus: customer.latestSubscriptionStatus,
    latestSubscriptionStopAfterCurrentPeriod:
      customer.latestSubscriptionStopAfterCurrentPeriod,
    subscriptionCount: customer.subscriptionCount,
  });
}

export function getCustomerLifecycleBadge(customer: CustomerFlowRecord) {
  const lifecycle = getCustomerLifecycleState(customer);

  switch (lifecycle.state) {
    case "active":
      return <Badge variant="default">Active</Badge>;
    case "payment_issue":
      return <Badge variant="destructive">Payment issue</Badge>;
    case "needs_setup":
      return (
        <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100/80">
          Needs setup
        </Badge>
      );
    case "onboarding":
      return <Badge variant="secondary">Onboarding</Badge>;
    case "paused":
      return <Badge variant="secondary">Paused</Badge>;
    case "ended":
      return <Badge variant="outline">Ended</Badge>;
    case "cancelled":
      return <Badge variant="outline">Cancelled</Badge>;
    default:
      return <Badge variant="outline">{formatLabel(lifecycle.state)}</Badge>;
  }
}

function HistoryRow({
  detail,
  label,
  meta,
  status,
}: Readonly<{
  detail: ReactNode;
  label: ReactNode;
  meta: ReactNode;
  status: ReactNode;
}>) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-md border px-3 py-2 text-sm">
      <div className="min-w-0">
        <div className="truncate font-medium">{label}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{meta}</div>
      </div>
      <div className="text-right">
        <div>{status}</div>
        <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
      </div>
    </div>
  );
}

function TimelineRow({
  item,
}: Readonly<{
  item: CustomerActivityTimeline["items"][number];
}>) {
  return (
    <div className="rounded-md border px-3 py-2 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Activity className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate font-medium">{item.title}</span>
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.summary}</p>
          <div className="mt-1 text-xs text-muted-foreground">
            {formatDateTime(item.occurredAt)} · {formatLabel(item.itemType)}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          {getTimelineSeverityBadge(item.severity)}
          <Button asChild variant="ghost" size="sm">
            <Link href={item.href}>Open</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

function SubscriptionSummaryRow({
  label,
  value,
}: Readonly<{
  label: string;
  value: ReactNode;
}>) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate text-right font-medium">{value}</span>
    </div>
  );
}

function CopyField({ value }: Readonly<{ value: string }>) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex items-center gap-2">
      <Input value={value} readOnly />
      <Button
        type="button"
        size="icon"
        variant="outline"
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      </Button>
    </div>
  );
}

function CustomerForm({
  action,
  eboekhoudenRelationId,
  initialData,
  onCancel,
  cancelLabel = "Cancel",
  returnTo,
  source = "local",
  submitLabel = "Create Customer",
}: Readonly<{
  action: (formData: FormData) => void | Promise<void>;
  cancelLabel?: string;
  eboekhoudenRelationId?: number;
  initialData?: Partial<CustomerFlowRecord> & { businessName?: string; contactName?: string };
  onCancel: () => void;
  returnTo: string;
  source?: "local" | "eboekhouden";
  submitLabel?: string;
}>) {
  return (
    <form className="space-y-4" action={action}>
      <input type="hidden" name="returnTo" value={returnTo} />
      <input type="hidden" name="source" value={source} />
      {eboekhoudenRelationId ? (
        <input
          type="hidden"
          name="eboekhoudenRelationId"
          value={eboekhoudenRelationId}
        />
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="businessName">Business Name</Label>
        <Input
          id="businessName"
          name="businessName"
          defaultValue={initialData?.businessName ?? ""}
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="contactName">Contact Name</Label>
        <Input
          id="contactName"
          name="contactName"
          defaultValue={initialData?.contactName ?? ""}
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          defaultValue={initialData?.email ?? ""}
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="address">Address</Label>
        <Input id="address" name="address" defaultValue={initialData?.address ?? ""} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="phone">Phone</Label>
        <Input id="phone" name="phone" defaultValue={initialData?.phone ?? ""} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" name="notes" defaultValue={initialData?.notes ?? ""} rows={4} />
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button type="submit">{submitLabel}</Button>
      </DialogFooter>
    </form>
  );
}

export function getCustomerDisplayName(customer: CustomerFlowRecord) {
  return customer.businessName ?? customer.contactName ?? customer.email;
}

export function getCustomerStage(customer: CustomerFlowRecord): CustomerStage {
  if (customer.latestSubscriptionStatus === "active") {
    return "subscription_active";
  }

  if (
    customer.latestFirstPaymentStatus === "paid" &&
    customer.latestFirstPaymentMode === "real_installment"
  ) {
    return "subscription_activation_pending";
  }

  if (customer.latestFirstPaymentStatus === "paid") {
    return "payment_completed";
  }

  if (
    customer.latestFirstPaymentLinkStatus &&
    !renewableLinkStatuses.has(customer.latestFirstPaymentLinkStatus)
  ) {
    return "payment_pending";
  }

  return "new";
}

function getCustomerRepairStorageKey(customer: CustomerFlowRecord, fingerprint: string) {
  return `repair:customer:${customer.mode}:${customer.id}:${fingerprint}`;
}

function shouldAutoRepairCustomer(customer: CustomerFlowRecord) {
  if (customer.archivedAt) {
    return false;
  }

  if (!customer.mollieCustomerId) {
    return false;
  }

  if (customer.eboekhoudenLinkStatus === "needs_review") {
    return true;
  }

  if (customer.eboekhoudenLinkStatus === "sync_error") {
    return true;
  }

  if (customer.latestSubscriptionStatus === "out_of_sync") {
    return true;
  }

  if (customer.latestSubscriptionStatus === "payment_action_required") {
    return true;
  }

  return isOlderThan(customer.lastSyncedAt, REPAIR_STALE_AFTER_MS);
}

function localFieldsFromCustomer(customer: CustomerFlowRecord): LocalRelationFields {
  return {
    address: customer.address ?? "",
    businessName: customer.businessName ?? "",
    contactName: customer.contactName ?? "",
    email: customer.email,
    notes: customer.notes ?? "",
    phone: customer.phone ?? "",
  };
}

function mergeLocalFields(
  customer: CustomerFlowRecord,
  eboekhoudenFields: LocalRelationFields,
) {
  const localFields = localFieldsFromCustomer(customer);

  return relationFieldNames.reduce((result, field) => {
    const eboekhoudenValue = eboekhoudenFields[field].trim();
    const localValue = localFields[field].trim();

    return {
      ...result,
      [field]: eboekhoudenValue || localValue,
    };
  }, {} as LocalRelationFields);
}

function EboekhoudenRelationPicker({
  onSelect,
}: Readonly<{
  onSelect: (detail: EboekhoudenRelationDetail) => void;
}>) {
  const [query, setQuery] = useState("");
  const [relations, setRelations] = useState<EboekhoudenRelationListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    async function loadRelations() {
      setIsLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          excludeLinked: "true",
          limit: "20",
          q: query,
        });
        const response = await fetch(`/api/eboekhouden/relations?${params}`, {
          signal: controller.signal,
        });
        const body = await response.json();

        if (!response.ok) {
          throw new Error(body.message ?? "Could not load e-Boekhouden relations.");
        }

        setRelations(body.items ?? []);
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(loadError instanceof Error ? loadError.message : "Could not load relations.");
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    const timer = window.setTimeout(loadRelations, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  async function selectRelation(relationId: number) {
    setError(null);
    setIsLoading(true);

    try {
      const response = await fetch(`/api/eboekhouden/relations/${relationId}`);
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.message ?? "Could not load the selected relation.");
      }

      onSelect(body);
    } catch (selectError) {
      setError(selectError instanceof Error ? selectError.message : "Could not load relation.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="space-y-4 py-2">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search e-Boekhouden relations..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="pl-9"
          />
        </div>
        <Button asChild type="button" variant="outline">
          <a
            href="https://secure.e-boekhouden.nl/bh/"
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink className="mr-2 h-4 w-4" />
            New
          </a>
        </Button>
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <ScrollArea className="h-[260px] rounded-md border p-2">
        {isLoading && relations.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading relations...</p>
        ) : null}

        {!isLoading && relations.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No available e-Boekhouden relations found.
          </p>
        ) : null}

        <div className="space-y-1">
          {relations.map((relation) => (
            <button
              key={relation.id}
              type="button"
              onClick={() => selectRelation(relation.id)}
              className="w-full rounded-sm p-3 text-left transition-colors hover:bg-accent"
            >
              <span className="block text-sm font-medium">
                {relation.name || relation.localFields?.businessName || relation.code || relation.id}
              </span>
              <span className="text-xs text-muted-foreground">
                {[
                  relation.code ? `Code ${relation.code}` : null,
                  relation.localFields?.contactName || null,
                  relation.localFields?.email || null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </button>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

function MergeEboekhoudenRelationForm({
  customer,
  detail,
  onBack,
}: Readonly<{
  customer: CustomerFlowRecord;
  detail: EboekhoudenRelationDetail;
  onBack: () => void;
}>) {
  const pathname = usePathname();
  const localFields = localFieldsFromCustomer(customer);
  const eboekhoudenFields = detail.localFields;
  const [fields, setFields] = useState<LocalRelationFields>(() =>
    mergeLocalFields(customer, eboekhoudenFields),
  );

  function setField(field: keyof LocalRelationFields, value: string) {
    setFields((current) => ({
      ...current,
      [field]: value,
    }));
  }

  return (
    <form
      className="flex min-h-0 flex-col gap-3"
      action={linkEboekhoudenRelationAction}
    >
      <input type="hidden" name="customerId" value={customer.id} />
      <input
        type="hidden"
        name="eboekhoudenRelationId"
        value={detail.relation.id}
      />
      <input type="hidden" name="returnTo" value={pathname} />

      <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
        Linking to relation{" "}
        <span className="font-medium">
          {detail.relation.name || detail.relation.code || detail.relation.id}
        </span>
        .
      </div>

      <div className="min-h-0 overflow-y-auto pr-1">
        <div className="grid gap-3 sm:grid-cols-2">
          {relationFieldNames.map((field) => {
            const localValue = localFields[field];
            const eboekhoudenValue = eboekhoudenFields[field];
            const isConflict =
              localValue.trim().length > 0 &&
              eboekhoudenValue.trim().length > 0 &&
              hasMeaningfulDifference(localValue, eboekhoudenValue);
            const isRequired =
              field === "businessName" || field === "contactName" || field === "email";
            const isLongField = field === "address" || field === "notes";

            return (
              <div
                key={field}
                className={`flex flex-col gap-1.5 ${isLongField ? "sm:col-span-2" : ""}`}
              >
                <Label className="text-xs" htmlFor={`merge-${field}`}>
                  {relationFieldLabels[field]}
                  {isRequired ? <span className="text-destructive"> *</span> : null}
                </Label>

                {isConflict ? (
                  <div className="rounded-md border bg-muted/40 p-2 text-xs">
                    <p className="mb-1 font-medium">Choose value</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Button
                        type="button"
                        variant={fields[field] === eboekhoudenValue ? "default" : "outline"}
                        className="h-auto justify-start whitespace-normal px-2 py-1.5 text-left text-xs"
                        onClick={() => setField(field, eboekhoudenValue)}
                      >
                        <span>
                          <span className="block opacity-70">e-Boekhouden</span>
                          {eboekhoudenValue}
                        </span>
                      </Button>
                      <Button
                        type="button"
                        variant={fields[field] === localValue ? "default" : "outline"}
                        className="h-auto justify-start whitespace-normal px-2 py-1.5 text-left text-xs"
                        onClick={() => setField(field, localValue)}
                      >
                        <span>
                          <span className="block opacity-70">Local</span>
                          {localValue}
                        </span>
                      </Button>
                    </div>
                  </div>
                ) : null}

                {field === "notes" ? (
                  <Textarea
                    id={`merge-${field}`}
                    name={field}
                    value={fields[field]}
                    onChange={(event) => setField(field, event.target.value)}
                    rows={2}
                  />
                ) : (
                  <Input
                    id={`merge-${field}`}
                    name={field}
                    type={field === "email" ? "email" : "text"}
                    value={fields[field]}
                    onChange={(event) => setField(field, event.target.value)}
                    required={isRequired}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <DialogFooter className="border-t pt-3">
        <Button type="button" variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button type="submit">Link</Button>
      </DialogFooter>
    </form>
  );
}

export function CreateCustomerDialog({
  open,
  onOpenChange,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
}>) {
  const pathname = usePathname();
  const [step, setStep] = useState<"source" | "scratch" | "import">("source");
  const [selectedRelation, setSelectedRelation] =
    useState<EboekhoudenRelationDetail | null>(null);

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setStep("source");
      setSelectedRelation(null);
    }

    onOpenChange(nextOpen);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Customer</DialogTitle>
          <DialogDescription>
            Create a new customer from scratch or import from e-Boekhouden.
          </DialogDescription>
        </DialogHeader>

        {step === "source" ? (
          <div className="grid grid-cols-2 gap-4 py-4">
            <button
              type="button"
              onClick={() => setStep("scratch")}
              className="flex flex-col items-center gap-3 rounded-lg border-2 border-border p-6 transition-colors hover:border-primary hover:bg-accent"
            >
              <PenLine className="h-8 w-8 text-muted-foreground" />
              <div className="text-center">
                <p className="text-sm font-medium">Create from scratch</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Manually enter all details
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setStep("import")}
              className="flex flex-col items-center gap-3 rounded-lg border-2 border-border p-6 transition-colors hover:border-primary hover:bg-accent"
            >
              <FileText className="h-8 w-8 text-muted-foreground" />
              <div className="text-center">
                <p className="text-sm font-medium">Import from e-Boekhouden</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Pre-fill from your bookkeeping
                </p>
              </div>
            </button>
          </div>
        ) : null}

        {step === "scratch" ? (
          <div className="space-y-4">
            <div className="rounded-md border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-950">
              This customer will be unlinked from e-Boekhouden until you link it later.
            </div>
            <CustomerForm
              action={createCustomerAction}
              onCancel={() => setStep("source")}
              cancelLabel="Back"
              returnTo={pathname}
            />
          </div>
        ) : null}

        {step === "import" ? (
          selectedRelation ? (
            <CustomerForm
              action={createCustomerAction}
              cancelLabel="Back"
              eboekhoudenRelationId={selectedRelation.relation.id}
              initialData={selectedRelation.localFields}
              onCancel={() => setSelectedRelation(null)}
              returnTo={pathname}
              source="eboekhouden"
              submitLabel="Import Customer"
            />
          ) : (
            <div className="space-y-4">
              <EboekhoudenRelationPicker onSelect={setSelectedRelation} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setStep("source")}>
                  Back
                </Button>
              </DialogFooter>
            </div>
          )
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function LinkEboekhoudenRelationDialog({
  customer,
  open,
  onOpenChange,
}: Readonly<{
  customer: CustomerFlowRecord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}>) {
  const [selectedRelation, setSelectedRelation] =
    useState<EboekhoudenRelationDetail | null>(null);

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setSelectedRelation(null);
    }

    onOpenChange(nextOpen);
  }

  if (!customer) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)] gap-3 overflow-hidden p-4 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Link to e-Boekhouden</DialogTitle>
          <DialogDescription>
            Select an unlinked relation and resolve any differences before linking.
          </DialogDescription>
        </DialogHeader>

        {selectedRelation ? (
          <MergeEboekhoudenRelationForm
            customer={customer}
            detail={selectedRelation}
            onBack={() => setSelectedRelation(null)}
          />
        ) : (
          <EboekhoudenRelationPicker onSelect={setSelectedRelation} />
        )}
      </DialogContent>
    </Dialog>
  );
}

export function CreatePaymentLinkDialog({
  customer,
  customers,
  open,
  onOpenChange,
}: Readonly<{
  customer: CustomerFlowRecord | null;
  customers: CustomerFlowRecord[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}>) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [step, setStep] = useState<"select_customer" | "payment_details">(
    customer ? "payment_details" : "select_customer",
  );
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(customer?.id ?? null);
  const [searchQuery, setSearchQuery] = useState("");
  const [firstPaymentMode, setFirstPaymentMode] = useState<
    "real_installment" | "mandate_only"
  >("real_installment");
  const [subscriptionAmount, setSubscriptionAmount] = useState("49.99");
  const [subscriptionInterval, setSubscriptionInterval] = useState<
    "weekly" | "monthly" | "yearly"
  >("monthly");
  const [subscriptionDescription, setSubscriptionDescription] = useState("Premium Plan");
  const [subscriptionStartDate, setSubscriptionStartDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [subscriptionTermMode, setSubscriptionTermMode] = useState<
    "open_ended" | "fixed_term"
  >("open_ended");
  const [totalPayments, setTotalPayments] = useState("12");
  const [serviceEndAt, setServiceEndAt] = useState("");

  const selectedCustomer =
    customer ?? customers.find((item) => item.id === selectedCustomerId) ?? null;
  const returnTo = selectedCustomer
    ? buildConsentLinkReturnTo({
        customerId: selectedCustomer.id,
        pathname,
        search: searchParams.toString(),
      })
    : pathname;

  const filteredCustomers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    if (!query) {
      return customers;
    }

    return customers.filter((item) =>
      [item.businessName, item.contactName, item.email]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [customers, searchQuery]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {step === "select_customer" ? "Select Customer" : "Create First Payment Consent Link"}
          </DialogTitle>
          <DialogDescription>
            {step === "select_customer"
              ? "Choose a customer to generate a consent link for."
              : `Generate a hosted consent link for ${selectedCustomer?.businessName ?? "this customer"}. The customer must accept terms in-app before entering Mollie checkout.`}
          </DialogDescription>
        </DialogHeader>

        {step === "select_customer" ? (
          <div className="space-y-4 py-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search customers..."
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="pl-9"
              />
            </div>

            <ScrollArea className="h-[200px] rounded-md border p-2">
              {filteredCustomers.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">No customers found.</p>
              ) : (
                <div className="space-y-1">
                  {filteredCustomers.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setSelectedCustomerId(item.id);
                        setStep("payment_details");
                      }}
                      className="w-full rounded-sm p-2 text-left transition-colors hover:bg-accent"
                    >
                      <span className="block text-sm font-medium">
                        {getCustomerDisplayName(item)}
                      </span>
                      <span className="text-xs text-muted-foreground">{item.email}</span>
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>

            <Button asChild variant="outline" className="w-full">
              <Link href="/customers">
                <Plus className="mr-2 h-4 w-4" />
                Create New Customer
              </Link>
            </Button>
          </div>
        ) : null}

        {step === "payment_details" && selectedCustomer ? (
          <form className="space-y-4 py-4" action={createFirstPaymentAction}>
            <input type="hidden" name="customerId" value={selectedCustomer.id} />
            <input type="hidden" name="returnTo" value={returnTo} />

            {!customer ? (
              <div className="mb-4 flex items-center justify-between rounded-md bg-muted p-3">
                <div className="flex flex-col">
                  <span className="text-xs text-muted-foreground">Selected Customer</span>
                  <span className="text-sm font-medium">{selectedCustomer.businessName}</span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setStep("select_customer")}
                  className="h-8 px-2"
                >
                  Change
                </Button>
              </div>
            ) : null}

            <div className="space-y-2">
              <Label>First payment mode</Label>
              <Select
                name="firstPaymentMode"
                value={firstPaymentMode}
                onValueChange={(value) =>
                  setFirstPaymentMode(value as "real_installment" | "mandate_only")
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select first payment mode" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="real_installment">Real first installment</SelectItem>
                  <SelectItem value="mandate_only">Mandate-only (€0.01)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="subscriptionAmountValue">Subscription amount (EUR)</Label>
              <Input
                id="subscriptionAmountValue"
                name="subscriptionAmountValue"
                value={subscriptionAmount}
                onChange={(event) => setSubscriptionAmount(event.target.value)}
                required
              />
              {firstPaymentMode === "mandate_only" ? (
                <p className="text-xs text-muted-foreground">
                  The first mandate-establishing payment will be fixed to €0.01.
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="subscriptionDescription">Subscription description</Label>
              <Input
                id="subscriptionDescription"
                name="subscriptionDescription"
                value={subscriptionDescription}
                onChange={(event) => setSubscriptionDescription(event.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label>Billing interval</Label>
              <Select
                name="subscriptionInterval"
                value={subscriptionInterval}
                onValueChange={(value) =>
                  setSubscriptionInterval(value as "weekly" | "monthly" | "yearly")
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select interval" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="yearly">Yearly</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="subscriptionStartDate">Subscription start date</Label>
              <Input
                id="subscriptionStartDate"
                name="subscriptionStartDate"
                type="date"
                value={subscriptionStartDate}
                onChange={(event) => setSubscriptionStartDate(event.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label>Subscription term</Label>
              <Select
                name="subscriptionTermMode"
                value={subscriptionTermMode}
                onValueChange={(value) =>
                  setSubscriptionTermMode(value as "open_ended" | "fixed_term")
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select subscription term" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open_ended">Open-ended</SelectItem>
                  <SelectItem value="fixed_term">Fixed-term</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="totalPayments">Total payments (fixed-term only)</Label>
              <Input
                id="totalPayments"
                name="totalPayments"
                value={totalPayments}
                onChange={(event) => setTotalPayments(event.target.value)}
                disabled={subscriptionTermMode !== "fixed_term"}
                required={subscriptionTermMode === "fixed_term"}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="serviceEndAt">Service end date (optional override)</Label>
              <Input
                id="serviceEndAt"
                name="serviceEndAt"
                type="date"
                value={serviceEndAt}
                onChange={(event) => setServiceEndAt(event.target.value)}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit">Generate Consent Link</Button>
            </DialogFooter>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function ConfirmPaymentDialog({
  customer,
  open,
  onOpenChange,
}: Readonly<{
  customer: CustomerFlowRecord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}>) {
  const pathname = usePathname();

  if (!customer) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Repair billing state</DialogTitle>
          <DialogDescription>
            Repair the Mollie payment, mandate, and subscription state for {customer.businessName}.
          </DialogDescription>
        </DialogHeader>
        <form action={syncCustomerBillingStateAction}>
          <input type="hidden" name="customerId" value={customer.id} />
          <input type="hidden" name="returnTo" value={pathname} />
          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Repair from Mollie</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CreateSubscriptionDialog({
  customer,
  open,
  onOpenChange,
}: Readonly<{
  customer: CustomerFlowRecord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}>) {
  const pathname = usePathname();

  if (!customer) {
    return null;
  }

  const isActivationRetry = getCustomerStage(customer) === "subscription_activation_pending";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isActivationRetry ? "Retry Subscription Activation" : "Create Subscription"}
          </DialogTitle>
          <DialogDescription>
            {isActivationRetry
              ? `Retry automatic subscription activation for ${customer.businessName} using the latest accepted consent terms and verified mandate.`
              : `Start the recurring subscription for ${customer.businessName} using the latest accepted consent terms and verified mandate.`}
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4 py-4" action={createSubscriptionAction}>
          <input type="hidden" name="customerId" value={customer.id} />
          <input type="hidden" name="returnTo" value={pathname} />

          <p className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
            The subscription amount, interval, term mode, and cancellation behavior are locked to
            the accepted consent snapshot.
          </p>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">
              {isActivationRetry ? "Retry Activation" : "Start Subscription"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CustomerDrawer({
  customer,
  open,
  onOpenChange,
  onOpenCreatePayment,
  onOpenConfirmPayment,
  onOpenLinkEboekhouden,
  onOpenCreateSubscription,
  onOpenArchiveCustomer,
  onOpenRestoreCustomer,
}: Readonly<{
  customer: CustomerFlowRecord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenCreatePayment: (customer: CustomerFlowRecord) => void;
  onOpenConfirmPayment: (customer: CustomerFlowRecord) => void;
  onOpenLinkEboekhouden: (customer: CustomerFlowRecord) => void;
  onOpenCreateSubscription: (customer: CustomerFlowRecord) => void;
  onOpenArchiveCustomer: (customer: CustomerFlowRecord) => void;
  onOpenRestoreCustomer: (customer: CustomerFlowRecord) => void;
}>) {
  const router = useRouter();
  const [repairError, setRepairError] = useState<string | null>(null);
  const [isRepairing, setIsRepairing] = useState(false);
  const [latestConsentUrl, setLatestConsentUrl] = useState<string | null>(null);
  const [isConsentLinkLoading, setIsConsentLinkLoading] = useState(false);
  const [billingHistory, setBillingHistory] = useState<CustomerBillingHistory | null>(null);
  const [billingHistoryError, setBillingHistoryError] = useState<string | null>(null);
  const [isBillingHistoryLoading, setIsBillingHistoryLoading] = useState(false);
  const [activityTimeline, setActivityTimeline] = useState<CustomerActivityTimeline | null>(null);
  const [activityTimelineError, setActivityTimelineError] = useState<string | null>(null);
  const [isActivityTimelineLoading, setIsActivityTimelineLoading] = useState(false);
  const [activityTimelineRefreshKey, setActivityTimelineRefreshKey] = useState(0);
  const [noteBody, setNoteBody] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);
  const [isAddingNote, setIsAddingNote] = useState(false);
  const currentCustomerId = customer?.id ?? null;

  useEffect(() => {
    const currentCustomer = customer;

    if (!open || !currentCustomer) {
      return;
    }

    if (!shouldAutoRepairCustomer(currentCustomer)) {
      return;
    }

    const fingerprint = [
      currentCustomer.lastSyncedAt ?? "never",
      currentCustomer.eboekhoudenLinkStatus,
      currentCustomer.latestSubscriptionStatus ?? "none",
    ].join(":");
    const customerId = currentCustomer.id;
    const storageKey = getCustomerRepairStorageKey(currentCustomer, fingerprint);
    const lastAttempt = Number(window.localStorage.getItem(storageKey) ?? "0");

    if (Number.isFinite(lastAttempt) && Date.now() - lastAttempt < REPAIR_RETRY_AFTER_MS) {
      return;
    }

    let active = true;
    window.localStorage.setItem(storageKey, String(Date.now()));
    setIsRepairing(true);
    setRepairError(null);

    async function repair() {
      try {
        const response = await fetch("/api/reliability/repair", {
          body: JSON.stringify({
            id: customerId,
            kind: "customer",
          }),
          headers: {
            "content-type": "application/json",
          },
          method: "POST",
        });
        const body = (await response.json().catch(() => null)) as
          | { error?: string; status?: string }
          | null;

        if (!response.ok) {
          throw new Error(
            body && typeof body.error === "string"
              ? body.error
              : "Failed to repair customer state.",
          );
        }

        if (active && body?.status === "repaired") {
          router.refresh();
        }
      } catch (repairError) {
        if (active) {
          setRepairError(
            repairError instanceof Error
              ? repairError.message
              : "Failed to repair customer state.",
          );
        }
      } finally {
        if (active) {
          setIsRepairing(false);
        }
      }
    }

    repair();

    return () => {
      active = false;
    };
  }, [customer, open, router]);

  useEffect(() => {
    setRepairError(null);
    setIsRepairing(false);
  }, [customer?.id]);

  useEffect(() => {
    const customerId = currentCustomerId;

    if (!open || !customerId) {
      setLatestConsentUrl(null);
      setIsConsentLinkLoading(false);
      return;
    }

    const resolvedCustomerId = customerId;

    let active = true;
    setLatestConsentUrl(null);
    setIsConsentLinkLoading(true);

    async function loadConsentLink() {
      try {
        const consentLinkUrl = new URL("/api/customer-consent-link", window.location.origin);
        consentLinkUrl.searchParams.set("customerId", resolvedCustomerId);
        const response = await fetch(consentLinkUrl.toString(), {
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => null)) as
          | { error?: string; latestConsentUrl?: string | null }
          | null;

        if (!response.ok) {
          throw new Error(
            payload && typeof payload.error === "string"
              ? payload.error
              : "Failed to load hosted consent link.",
          );
        }

        if (active) {
          setLatestConsentUrl(
            payload && typeof payload.latestConsentUrl === "string"
              ? payload.latestConsentUrl
              : null,
          );
        }
      } catch {
        if (active) {
          setLatestConsentUrl(null);
        }
      } finally {
        if (active) {
          setIsConsentLinkLoading(false);
        }
      }
    }

    loadConsentLink();

    return () => {
      active = false;
    };
  }, [currentCustomerId, open]);

  useEffect(() => {
    const customerId = currentCustomerId;

    if (!open || !customerId) {
      setBillingHistory(null);
      setBillingHistoryError(null);
      setIsBillingHistoryLoading(false);
      return;
    }

    let active = true;
    const resolvedCustomerId = customerId;
    setBillingHistory(null);
    setBillingHistoryError(null);
    setIsBillingHistoryLoading(true);

    async function loadBillingHistory() {
      try {
        const response = await fetch(
          `/api/customers/${encodeURIComponent(resolvedCustomerId)}/billing-history`,
          {
            cache: "no-store",
          },
        );
        const payload = (await response.json().catch(() => null)) as
          | (CustomerBillingHistory & { error?: string })
          | null;

        if (!response.ok) {
          throw new Error(
            payload && typeof payload.error === "string"
              ? payload.error
              : "Failed to load customer billing history.",
          );
        }

        if (active) {
          setBillingHistory(payload);
        }
      } catch (historyError) {
        if (active) {
          setBillingHistoryError(
            historyError instanceof Error
              ? historyError.message
              : "Failed to load customer billing history.",
          );
        }
      } finally {
        if (active) {
          setIsBillingHistoryLoading(false);
        }
      }
    }

    loadBillingHistory();

    return () => {
      active = false;
    };
  }, [currentCustomerId, open]);

  useEffect(() => {
    const customerId = currentCustomerId;

    if (!open || !customerId) {
      setActivityTimeline(null);
      setActivityTimelineError(null);
      setIsActivityTimelineLoading(false);
      return;
    }

    let active = true;
    const resolvedCustomerId = customerId;
    setActivityTimeline(null);
    setActivityTimelineError(null);
    setIsActivityTimelineLoading(true);

    async function loadActivityTimeline() {
      try {
        const response = await fetch(
          `/api/customers/${encodeURIComponent(resolvedCustomerId)}/activity`,
          {
            cache: "no-store",
          },
        );
        const payload = (await response.json().catch(() => null)) as
          | (CustomerActivityTimeline & { error?: string })
          | null;

        if (!response.ok) {
          throw new Error(
            payload && typeof payload.error === "string"
              ? payload.error
              : "Failed to load customer activity.",
          );
        }

        if (active) {
          setActivityTimeline(payload);
        }
      } catch (timelineError) {
        if (active) {
          setActivityTimelineError(
            timelineError instanceof Error
              ? timelineError.message
              : "Failed to load customer activity.",
          );
        }
      } finally {
        if (active) {
          setIsActivityTimelineLoading(false);
        }
      }
    }

    loadActivityTimeline();

    return () => {
      active = false;
    };
  }, [activityTimelineRefreshKey, currentCustomerId, open]);

  if (!customer) {
    return null;
  }

  async function handleAddCustomerNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!currentCustomerId || !noteBody.trim()) {
      setNoteError("Enter a note before saving.");
      return;
    }

    setIsAddingNote(true);
    setNoteError(null);

    try {
      const response = await fetch(
        `/api/customers/${encodeURIComponent(currentCustomerId)}/notes`,
        {
          body: JSON.stringify({ body: noteBody }),
          cache: "no-store",
          headers: {
            "content-type": "application/json",
          },
          method: "POST",
        },
      );
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;

      if (!response.ok) {
        throw new Error(
          payload && typeof payload.error === "string"
            ? payload.error
            : "Failed to add customer note.",
        );
      }

      setNoteBody("");
      setActivityTimelineRefreshKey((value) => value + 1);
      router.refresh();
    } catch (createError) {
      setNoteError(
        createError instanceof Error
          ? createError.message
          : "Failed to add customer note.",
      );
    } finally {
      setIsAddingNote(false);
    }
  }

  const stage = getCustomerStage(customer);
  const isArchived = Boolean(customer.archivedAt);
  const showOnboardingSections = stage !== "subscription_active";
  const currentStepIndex = [
    "new",
    "payment_pending",
    "payment_completed",
    "subscription_activation_pending",
    "subscription_active",
  ].indexOf(stage);
  const latestPaymentDateLabel =
    customer.latestPaymentStatus === "paid" && customer.latestPaymentPaidAt
      ? "Paid on"
      : "Created on";
  const latestPaymentDateValue =
    customer.latestPaymentStatus === "paid" && customer.latestPaymentPaidAt
      ? customer.latestPaymentPaidAt
      : customer.latestPaymentCreatedAt;
  const hasSubscriptionDetails = Boolean(
    customer.latestSubscriptionId ||
      customer.latestFirstPaymentMode ||
      customer.latestConsentAcceptedAt,
  );
  const hasConsentLinkSection = Boolean(
    latestConsentUrl ||
      isConsentLinkLoading ||
      customer.latestFirstPaymentMode ||
      customer.latestConsentAcceptedAt ||
      customer.latestFirstPaymentPaidAt,
  );
  const lifecycle = getCustomerLifecycleState(customer);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto z-50 px-6">
        <SheetHeader className="pb-6">
          <SheetTitle className="text-2xl">{getCustomerDisplayName(customer)}</SheetTitle>
          <SheetDescription>
            {isArchived
              ? `Archived on ${formatDate(customer.archivedAt ?? customer.createdAt)}`
              : `Customer since ${formatDate(customer.createdAt)}`}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-8">
          {isRepairing ? (
            <div className="flex items-center gap-2 rounded-md border p-4 text-sm text-muted-foreground">
              <LoaderCircle className="h-4 w-4 animate-spin" />
              Repairing local customer graph from Mollie...
            </div>
          ) : null}

          {repairError ? (
            <Alert variant="destructive">
              <AlertTitle>Repair failed</AlertTitle>
              <AlertDescription>{repairError}</AlertDescription>
            </Alert>
          ) : null}

          <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3 rounded-md border bg-muted/30 p-4">
              <div className="min-w-0 space-y-1">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  Lifecycle
                </h3>
                <p className="text-sm font-medium">{formatLabel(lifecycle.state)}</p>
                <p className="text-sm text-muted-foreground">{lifecycle.summary}</p>
                <p className="text-xs text-muted-foreground">
                  Source: {formatLabel(lifecycle.reason)}
                </p>
              </div>
              {getCustomerLifecycleBadge(customer)}
            </div>

            <Separator />

            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Personal details
            </h3>
            <div className="space-y-3 text-sm">
              <div className="flex items-start gap-3">
                <User className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <span>{customer.contactName}</span>
              </div>
              <div className="flex items-start gap-3">
                <Mail className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <span>{customer.email}</span>
              </div>
              {customer.phone ? (
                <div className="flex items-start gap-3">
                  <Phone className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <span>{customer.phone}</span>
                </div>
              ) : null}
              {customer.address ? (
                <div className="flex items-start gap-3">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <span>{customer.address}</span>
                </div>
              ) : null}
              {customer.notes ? (
                <div className="flex items-start gap-3">
                  <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="italic text-muted-foreground">{customer.notes}</span>
                </div>
              ) : null}
              <div className="flex items-start gap-3">
                <LinkIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm">
                      {customer.eboekhoudenRelationCode
                        ? `e-Boekhouden linked${customer.eboekhoudenRelationCode ? ` · Relation ${customer.eboekhoudenRelationCode}` : ""}`
                        : "No e-Boekhouden relation linked."}
                    </span>
                    {customer.eboekhoudenLinkStatus !== "linked"
                      ? getEboekhoudenStatusBadge(customer)
                      : null}
                  </div>
                </div>
                {!isArchived && customer.eboekhoudenLinkStatus === "unlinked" ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onOpenLinkEboekhouden(customer)}
                  >
                    Link
                  </Button>
                ) : null}
              </div>
            </div>
          </div>

          <Separator />

          <div className="space-y-4">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Subscription details
            </h3>
            {hasSubscriptionDetails ? (
              <div className="flex flex-col gap-3">
                {customer.latestFirstPaymentMode ? (
                  <SubscriptionSummaryRow
                    label="Started with"
                    value={formatFirstPaymentMode(customer.latestFirstPaymentMode)}
                  />
                ) : null}
                {customer.latestConsentAcceptedAt ? (
                  <SubscriptionSummaryRow
                    label="Consent accepted"
                    value={formatDate(customer.latestConsentAcceptedAt)}
                  />
                ) : null}
                {customer.latestSubscriptionId ? (
                  <>
                    <SubscriptionSummaryRow
                      label="Amount"
                      value={
                        customer.latestSubscriptionAmountValue &&
                        customer.latestSubscriptionAmountCurrency
                          ? formatCurrency(
                              customer.latestSubscriptionAmountValue,
                              customer.latestSubscriptionAmountCurrency,
                            )
                          : "Not available"
                      }
                    />
                    <SubscriptionSummaryRow
                      label="Period"
                      value={formatSubscriptionInterval(customer.latestSubscriptionInterval)}
                    />
                    <SubscriptionSummaryRow
                      label="Term mode"
                      value={formatLabel(customer.latestSubscriptionTermMode)}
                    />
                    {customer.latestSubscriptionTermMode === "fixed_term" ? (
                      <SubscriptionSummaryRow
                        label="Total payments"
                        value={customer.latestSubscriptionTotalPayments ?? "Not available"}
                      />
                    ) : null}
                    <SubscriptionSummaryRow
                      label="Start date"
                      value={formatDate(customer.latestSubscriptionStartDate)}
                    />
                    <SubscriptionSummaryRow
                      label="Last charge date"
                      value={formatDate(customer.latestSubscriptionLastChargeDate)}
                    />
                    <SubscriptionSummaryRow
                      label="Service end at"
                      value={formatDate(customer.latestSubscriptionServiceEndAt)}
                    />
                    <SubscriptionSummaryRow
                      label="Next payment"
                      value={formatDate(customer.latestSubscriptionNextPaymentDate)}
                    />
                    <SubscriptionSummaryRow
                      label="Cancellation effect"
                      value={formatLabel(customer.latestSubscriptionCancellationEffect)}
                    />
                    <SubscriptionSummaryRow
                      label="Status"
                      value={getSubscriptionStatusBadge(customer.latestSubscriptionStatus)}
                    />
                    <SubscriptionSummaryRow
                      label="Last synced"
                      value={
                        customer.lastSyncedAt ? formatDateTime(customer.lastSyncedAt) : "Not available"
                      }
                    />
                    <SubscriptionSummaryRow
                      label="Future charges"
                      value={
                        customer.latestSubscriptionStopAfterCurrentPeriod
                          ? "Stop after current period"
                          : "Continue"
                      }
                    />
                  </>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No subscription details yet.
              </p>
            )}
          </div>

          {customer.latestPaymentId ? (
            <>
              <Separator />
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                    Latest payment
                  </h3>
                  {getPaymentStatusBadge(customer.latestPaymentStatus)}
                </div>
                <div className="flex flex-col gap-3">
                  <SubscriptionSummaryRow
                    label="Amount"
                    value={
                      customer.latestPaymentAmountValue && customer.latestPaymentAmountCurrency
                        ? formatCurrency(
                            customer.latestPaymentAmountValue,
                            customer.latestPaymentAmountCurrency,
                          )
                        : "Not available"
                    }
                  />
                  <SubscriptionSummaryRow
                    label="Type"
                    value={formatPaymentType(customer.latestPaymentType)}
                  />
                  <SubscriptionSummaryRow
                    label={latestPaymentDateLabel}
                    value={formatDate(latestPaymentDateValue)}
                  />
                  <Button asChild variant="outline" size="sm" className="mt-1 w-full">
                    <Link href={`/payments?customerId=${encodeURIComponent(customer.id)}`}>
                      View all their payments
                    </Link>
                  </Button>
                </div>
              </div>
            </>
          ) : null}

          <Separator />
          <div className="space-y-4">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Activity timeline
            </h3>
            <form className="space-y-2" onSubmit={handleAddCustomerNote}>
              <Textarea
                value={noteBody}
                onChange={(event) => setNoteBody(event.target.value)}
                maxLength={2000}
                placeholder="Add an internal customer note"
                rows={3}
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">{noteBody.length}/2000</p>
                <Button type="submit" size="sm" disabled={isAddingNote || !noteBody.trim()}>
                  {isAddingNote ? (
                    <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <PenLine className="mr-2 h-4 w-4" />
                  )}
                  Add note
                </Button>
              </div>
              {noteError ? <p className="text-sm text-destructive">{noteError}</p> : null}
            </form>
            {isActivityTimelineLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <LoaderCircle className="h-4 w-4 animate-spin" />
                Loading activity...
              </div>
            ) : null}
            {activityTimelineError ? (
              <p className="text-sm text-destructive">{activityTimelineError}</p>
            ) : null}
            {activityTimeline ? (
              <div className="space-y-2">
                {activityTimeline.items.length > 0 ? (
                  activityTimeline.items.slice(0, 10).map((item) => (
                    <TimelineRow key={item.id} item={item} />
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">No activity yet.</p>
                )}
              </div>
            ) : null}
          </div>

          <Separator />
          <div className="space-y-4">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Billing history
            </h3>
            {isBillingHistoryLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <LoaderCircle className="h-4 w-4 animate-spin" />
                Loading history...
              </div>
            ) : null}
            {billingHistoryError ? (
              <p className="text-sm text-destructive">{billingHistoryError}</p>
            ) : null}
            {billingHistory ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Subscriptions
                  </p>
                  {billingHistory.subscriptions.length > 0 ? (
                    billingHistory.subscriptions.slice(0, 4).map((subscription) => (
                      <HistoryRow
                        key={subscription.id}
                        label={subscription.description}
                        meta={`${formatCurrency(
                          subscription.amountValue,
                          subscription.amountCurrency,
                        )} · ${formatSubscriptionInterval(subscription.interval)}`}
                        status={getSubscriptionStatusBadge(subscription.localStatus)}
                        detail={`Next ${formatDate(subscription.nextPaymentDate)}`}
                      />
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">No subscription rows.</p>
                  )}
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Mandates
                  </p>
                  {billingHistory.mandates.length > 0 ? (
                    billingHistory.mandates.slice(0, 4).map((mandate) => (
                      <HistoryRow
                        key={mandate.id}
                        label={mandate.mollieMandateId}
                        meta={formatLabel(mandate.method)}
                        status={
                          <Badge variant={mandate.isValid ? "default" : "outline"}>
                            {formatLabel(mandate.mollieStatus)}
                          </Badge>
                        }
                        detail={formatDate(mandate.createdAt)}
                      />
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">No mandate rows.</p>
                  )}
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Payments
                  </p>
                  {billingHistory.payments.length > 0 ? (
                    billingHistory.payments.slice(0, 6).map((payment) => (
                      <HistoryRow
                        key={payment.id}
                        label={formatHistoryPaymentType(payment.paymentType)}
                        meta={formatCurrency(payment.amountValue, payment.amountCurrency)}
                        status={getHistoryPaymentStatusBadge(payment.mollieStatus)}
                        detail={formatDate(payment.paidAt ?? payment.failedAt ?? payment.createdAt)}
                      />
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">No payment rows.</p>
                  )}
                </div>
              </div>
            ) : null}
          </div>

          {showOnboardingSections ? (
            <>
              <Separator />
              <div className="space-y-4">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  Workflow status
                </h3>
                <div className="space-y-0">
                  {[
                    "Customer Created",
                    "Consent Link Generated",
                    "First Payment Completed",
                    "Subscription Activation Pending",
                    "Subscription Active",
                  ].map((label, index) => {
                    const isCompleted = index <= currentStepIndex;
                    const isCurrent = index === currentStepIndex;
                    const isLast = index === 4;

                    return (
                      <div key={label} className="flex gap-3">
                        <div className="flex flex-col items-center">
                          <div
                            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${
                              isCompleted ? "border-primary bg-primary" : "border-muted bg-background"
                            }`}
                          >
                            {isCompleted ? (
                              <CheckCircle className="h-3.5 w-3.5 text-primary-foreground" />
                            ) : null}
                          </div>
                          {!isLast ? (
                            <div
                              className={`min-h-6 w-0.5 flex-1 ${
                                index < currentStepIndex ? "bg-primary" : "bg-muted"
                              }`}
                            />
                          ) : null}
                        </div>
                        <div
                          className={`pb-6 pt-0.5 text-sm ${
                            isCurrent
                              ? "font-semibold text-foreground"
                              : isCompleted
                                ? "font-medium text-foreground"
                                : "text-muted-foreground"
                          }`}
                        >
                          {label}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          ) : null}

          {showOnboardingSections && hasConsentLinkSection ? (
            <>
              <Separator />
              <div className="space-y-4">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  Payment context
                </h3>
                {isConsentLinkLoading ? (
                  <p className="text-sm text-muted-foreground">
                    Loading hosted consent link...
                  </p>
                ) : null}
                {latestConsentUrl ? (
                  <div className="space-y-2">
                    <Label>Hosted consent link</Label>
                    <CopyField value={latestConsentUrl} />
                  </div>
                ) : null}
                {customer.latestConsentAcceptedAt ? (
                  <p className="text-sm text-muted-foreground">
                    Consent accepted on {formatDate(customer.latestConsentAcceptedAt)}
                  </p>
                ) : null}
                {customer.latestFirstPaymentPaidAt ? (
                  <p className="text-sm text-muted-foreground">
                    Paid on {formatDate(customer.latestFirstPaymentPaidAt)}
                  </p>
                ) : null}
              </div>
            </>
          ) : null}

          <div className="flex flex-col gap-2 pt-4">
            {isArchived ? (
              <Button className="w-full" onClick={() => onOpenRestoreCustomer(customer)}>
                <RotateCcw className="mr-2 h-4 w-4" />
                Restore Customer
              </Button>
            ) : null}

            {!isArchived && getCustomerActionKind(customer) === "create_payment" ? (
              <Button className="w-full" onClick={() => onOpenCreatePayment(customer)}>
                <LinkIcon className="mr-2 h-4 w-4" />
                Create Consent Link
              </Button>
            ) : null}

            {!isArchived && getCustomerActionKind(customer) === "confirm_payment" ? (
              <Button className="w-full" onClick={() => onOpenConfirmPayment(customer)}>
                <CheckCircle className="mr-2 h-4 w-4" />
                Refresh Payment
              </Button>
            ) : null}

            {!isArchived && getCustomerActionKind(customer) === "create_subscription" ? (
              <Button className="w-full" onClick={() => onOpenCreateSubscription(customer)}>
                <Repeat className="mr-2 h-4 w-4" />
                Create Subscription
              </Button>
            ) : null}

            {!isArchived && getCustomerActionKind(customer) === "activation_pending" ? (
              <Button className="w-full" variant="outline" onClick={() => onOpenCreateSubscription(customer)}>
                <Repeat className="mr-2 h-4 w-4" />
                Retry Subscription Activation
              </Button>
            ) : null}

            {!isArchived ? (
              <Button
                className="w-full border-destructive/40 text-destructive hover:border-destructive hover:bg-destructive hover:text-destructive-foreground"
                variant="outline"
                onClick={() => onOpenArchiveCustomer(customer)}
              >
                <Archive className="mr-2 h-4 w-4" />
                Archive Customer
              </Button>
            ) : null}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
