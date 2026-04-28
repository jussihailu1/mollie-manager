"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
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
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency, formatDate, formatLabel } from "@/lib/format";
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
  latestFirstPaymentCheckoutUrl: string | null;
  latestFirstPaymentLinkStatus: string | null;
  latestFirstPaymentLinkUrl: string | null;
  latestFirstPaymentPaidAt: string | null;
  latestFirstPaymentStatus: string | null;
  latestMandateStatus: string | null;
  latestSubscriptionAmountCurrency: string | null;
  latestSubscriptionAmountValue: string | null;
  latestSubscriptionDescription: string | null;
  latestSubscriptionId: string | null;
  latestSubscriptionInterval: string | null;
  latestSubscriptionMollieStatus: string | null;
  latestSubscriptionNextPaymentDate: string | null;
  latestSubscriptionStartDate: string | null;
  latestSubscriptionStatus: string | null;
  latestSubscriptionStopAfterCurrentPeriod: boolean | null;
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

export type CustomerStage =
  | "new"
  | "payment_pending"
  | "payment_completed"
  | "subscription_active";

type CustomerActionKind =
  | "create_payment"
  | "confirm_payment"
  | "create_subscription"
  | "active";

function getStatusBadge(stage: CustomerStage) {
  switch (stage) {
    case "payment_pending":
      return (
        <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100/80">
          Payment Pending
        </Badge>
      );
    case "payment_completed":
      return <Badge variant="secondary">Payment Completed</Badge>;
    case "subscription_active":
      return <Badge variant="default">Subscription Active</Badge>;
    default:
      return <Badge variant="outline">New</Badge>;
  }
}

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
  const [step, setStep] = useState<"select_customer" | "payment_details">(
    customer ? "payment_details" : "select_customer",
  );
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(customer?.id ?? null);
  const [searchQuery, setSearchQuery] = useState("");
  const [amount, setAmount] = useState("10.00");
  const [description, setDescription] = useState("First mandate payment");

  const selectedCustomer =
    customer ?? customers.find((item) => item.id === selectedCustomerId) ?? null;

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
            {step === "select_customer" ? "Select Customer" : "Create First Payment Link"}
          </DialogTitle>
          <DialogDescription>
            {step === "select_customer"
              ? "Choose a customer to generate a payment link for."
              : `Generate a payment link for ${selectedCustomer?.businessName ?? "this customer"}. This is required to establish a mandate before creating a subscription.`}
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
            <input type="hidden" name="returnTo" value={pathname} />

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
              <Label htmlFor="amountValue">Amount (EUR)</Label>
              <Input
                id="amountValue"
                name="amountValue"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="paymentDescription">Description</Label>
              <Input
                id="paymentDescription"
                name="description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                required
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit">Generate Link</Button>
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
          <DialogTitle>Refresh Payment Status</DialogTitle>
          <DialogDescription>
            Refresh the Mollie payment, mandate, and subscription state for {customer.businessName}.
          </DialogDescription>
        </DialogHeader>
        <form action={syncCustomerBillingStateAction}>
          <input type="hidden" name="customerId" value={customer.id} />
          <input type="hidden" name="returnTo" value={pathname} />
          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Refresh from Mollie</Button>
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
  const [amount, setAmount] = useState("49.99");
  const [interval, setInterval] = useState<"weekly" | "monthly" | "yearly">("monthly");
  const [description, setDescription] = useState("Premium Plan");
  const [startDate, setStartDate] = useState(new Date().toISOString().split("T")[0] ?? "");

  if (!customer) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Subscription</DialogTitle>
          <DialogDescription>
            Configure a recurring subscription for {customer.businessName}. They have a valid
            mandate.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4 py-4" action={createSubscriptionAction}>
          <input type="hidden" name="customerId" value={customer.id} />
          <input type="hidden" name="returnTo" value={pathname} />

          <div className="space-y-2">
            <Label htmlFor="subscriptionAmount">Amount (EUR)</Label>
            <Input
              id="subscriptionAmount"
              name="amountValue"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label>Interval</Label>
            <Select
              name="interval"
              value={interval}
              onValueChange={(value) => setInterval(value as typeof interval)}
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
            <Label htmlFor="subscriptionDescription">Description</Label>
            <Input
              id="subscriptionDescription"
              name="description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="subscriptionStartDate">Start Date</Label>
            <Input
              id="subscriptionStartDate"
              name="startDate"
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              required
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Start Subscription</Button>
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
  if (!customer) {
    return null;
  }

  const stage = getCustomerStage(customer);
  const isArchived = Boolean(customer.archivedAt);
  const currentStepIndex = [
    "new",
    "payment_pending",
    "payment_completed",
    "subscription_active",
  ].indexOf(stage);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto z-50 px-6">
        <SheetHeader className="pb-6">
          <div className="flex items-center gap-2">
            <SheetTitle className="text-2xl">{customer.businessName}</SheetTitle>
            {isArchived ? <Badge variant="secondary">Archived</Badge> : getStatusBadge(stage)}
            {getEboekhoudenStatusBadge(customer)}
          </div>
          <SheetDescription>
            {isArchived
              ? `Archived on ${formatDate(customer.archivedAt ?? customer.createdAt)}`
              : `Customer since ${formatDate(customer.createdAt)}`}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-8">
          <div className="space-y-4">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Details
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
            </div>
          </div>

          <Separator />

          <div className="space-y-4">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              e-Boekhouden
            </h3>
            <div className="flex items-center justify-between gap-3 rounded-md border p-3">
              <div className="min-w-0">
                <div className="mb-1">{getEboekhoudenStatusBadge(customer)}</div>
                <p className="truncate text-sm text-muted-foreground">
                  {customer.eboekhoudenRelationCode
                    ? `Relation ${customer.eboekhoudenRelationCode}`
                    : "No e-Boekhouden relation linked."}
                </p>
              </div>
              {!isArchived && customer.eboekhoudenLinkStatus === "unlinked" ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onOpenLinkEboekhouden(customer)}
                >
                  <LinkIcon className="mr-2 h-4 w-4" />
                  Link
                </Button>
              ) : null}
            </div>
          </div>

          <Separator />

          <div className="space-y-4">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Workflow Status
            </h3>
            <div className="space-y-0">
              {[
                "Customer Created",
                "Payment Link Generated",
                "First Payment Completed",
                "Subscription Active",
              ].map((label, index) => {
                const isCompleted = index <= currentStepIndex;
                const isCurrent = index === currentStepIndex;
                const isLast = index === 3;

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

          {customer.latestSubscriptionId ? (
            <>
              <Separator />
              <div className="space-y-4">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  Subscription
                </h3>
                <div className="rounded-md border p-3">
                  <div className="flex flex-col gap-3">
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
                      label="Start date"
                      value={formatDate(customer.latestSubscriptionStartDate)}
                    />
                    <SubscriptionSummaryRow
                      label="Next payment"
                      value={formatDate(customer.latestSubscriptionNextPaymentDate)}
                    />
                    <SubscriptionSummaryRow
                      label="Status"
                      value={
                        <Badge variant="outline">
                          {formatLabel(customer.latestSubscriptionStatus)}
                        </Badge>
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
                  </div>
                </div>
              </div>
            </>
          ) : null}

          {customer.latestFirstPaymentLinkUrl || customer.latestFirstPaymentPaidAt ? (
            <>
              <Separator />
              <div className="space-y-4">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  Payment Context
                </h3>
                {customer.latestFirstPaymentLinkUrl ? (
                  <div className="space-y-2">
                    <Label>Payment Link</Label>
                    <CopyField value={customer.latestFirstPaymentLinkUrl} />
                  </div>
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
                Create Payment Link
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

            {!isArchived && getCustomerActionKind(customer) === "active" ? (
              <Button className="w-full" variant="outline" disabled>
                Subscription is Active
              </Button>
            ) : null}

            {!isArchived ? (
              <Button
                className="w-full"
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
