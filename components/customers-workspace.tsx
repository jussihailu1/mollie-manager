"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Archive,
  ChevronRight,
  Plus,
  RotateCcw,
  Search,
  Unlink,
} from "lucide-react";

import {
  ConfirmPaymentDialog,
  CreateCustomerDialog,
  CreatePaymentLinkDialog,
  CreateSubscriptionDialog,
  CustomerDrawer,
  LinkEboekhoudenRelationDialog,
  type CustomerFlowRecord,
  getCustomerDisplayName,
  getCustomerLifecycleBadge,
  getCustomerStage,
} from "@/components/customer-flow-dialogs";
import {
  archiveCustomerAction,
  restoreCustomerAction,
} from "@/lib/onboarding/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency, formatDate, formatLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

type CustomerView = "all" | "setup" | "active" | "archived";
type SortField =
  | "businessName"
  | "contactName"
  | "status"
  | "createdAt"
  | "subscriptionAmount"
  | "subscriptionInterval"
  | "nextPaymentDate";
type SortDirection = "asc" | "desc";

const statusOrder = {
  new: 0,
  payment_pending: 1,
  payment_completed: 2,
  subscription_activation_pending: 3,
  subscription_active: 4,
} as const;

const CUSTOMER_VIEWS = [
  { label: "All", value: "all" },
  { label: "Needs setup", value: "setup" },
  { label: "Active subscriptions", value: "active" },
  { label: "Archived", value: "archived" },
] as const;

function getStatusBadge(stage: ReturnType<typeof getCustomerStage>) {
  switch (stage) {
    case "payment_pending":
      return (
        <Badge className="whitespace-nowrap bg-yellow-100 text-yellow-800 hover:bg-yellow-100/80">
          Payment Pending
        </Badge>
      );
    case "payment_completed":
      return <Badge variant="secondary" className="whitespace-nowrap">Payment Completed</Badge>;
    case "subscription_activation_pending":
      return (
        <Badge className="whitespace-nowrap bg-sky-100 text-sky-900 hover:bg-sky-100/80">
          Activation Pending
        </Badge>
      );
    case "subscription_active":
      return <Badge variant="default" className="whitespace-nowrap">Subscription Active</Badge>;
    default:
      return <Badge variant="outline">New</Badge>;
  }
}

function getActionKind(customer: CustomerFlowRecord) {
  const stage = getCustomerStage(customer);

  if (stage === "new") {
    return "create_payment";
  }

  if (stage === "payment_pending") {
    return "confirm_payment";
  }

  if (stage === "subscription_activation_pending") {
    return "activation_pending";
  }

  if (stage === "payment_completed") {
    return "create_subscription";
  }

  return "active";
}

function parseCustomerView(value: string | null | undefined): CustomerView {
  return value === "setup" || value === "active" || value === "archived"
    ? value
    : "all";
}

function isActiveSubscription(customer: CustomerFlowRecord) {
  return getCustomerStage(customer) === "subscription_active";
}

function isSetupCustomer(customer: CustomerFlowRecord) {
  return !isActiveSubscription(customer);
}

function formatTableDate(value: string | null | undefined) {
  return value ? formatDate(value) : "-";
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
      return value ? formatLabel(value) : "-";
  }
}

function formatSubscriptionAmount(customer: CustomerFlowRecord) {
  return customer.latestSubscriptionAmountValue && customer.latestSubscriptionAmountCurrency
    ? formatCurrency(
        customer.latestSubscriptionAmountValue,
        customer.latestSubscriptionAmountCurrency,
      )
    : "-";
}

function getSubscriptionStatusBadge(customer: CustomerFlowRecord) {
  const status = customer.latestSubscriptionStatus;

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

function CustomerArchiveDialog({
  action,
  customer,
  onOpenChange,
  open,
  returnTo,
}: Readonly<{
  action: "archive" | "restore";
  customer: CustomerFlowRecord | null;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  returnTo: string;
}>) {
  if (!customer) {
    return null;
  }

  const isRestore = action === "restore";
  const formAction = isRestore ? restoreCustomerAction : archiveCustomerAction;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {isRestore ? "Restore customer?" : "Archive customer?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {isRestore
              ? `${getCustomerDisplayName(customer)} will return to the active customer list.`
              : `${getCustomerDisplayName(customer)} will be hidden from the default customer list. Payment history, Mollie data, and e-Boekhouden data will be left untouched.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <form action={formAction}>
          <input type="hidden" name="customerId" value={customer.id} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <AlertDialogFooter>
            <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
            <Button type="submit" variant={isRestore ? "default" : "destructive"}>
              {isRestore ? (
                <RotateCcw aria-hidden="true" />
              ) : (
                <Archive aria-hidden="true" />
              )}
              {isRestore ? "Restore" : "Archive"}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function SortIcon({
  field,
  sortDirection,
  sortField,
}: Readonly<{
  field: SortField;
  sortDirection: SortDirection;
  sortField: SortField;
}>) {
  if (sortField !== field) {
    return <ArrowUpDown className="ml-1 h-3 w-3 opacity-40" />;
  }

  return sortDirection === "asc" ? (
    <ArrowUp className="ml-1 h-3 w-3" />
  ) : (
    <ArrowDown className="ml-1 h-3 w-3" />
  );
}

export function CustomersWorkspace({
  archivedCustomers,
  customers,
  error,
  initialFocusId,
  initialView = "all",
  notice,
}: Readonly<{
  archivedCustomers: CustomerFlowRecord[];
  customers: CustomerFlowRecord[];
  error?: string | null;
  initialFocusId?: string | null;
  initialView?: string | null;
  notice?: string | null;
}>) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = searchParams.toString()
    ? `${pathname}?${searchParams.toString()}`
    : pathname;
  const activeView = parseCustomerView(searchParams.get("view") ?? initialView);
  const visibleCustomers = activeView === "archived" ? archivedCustomers : customers;
  const focusedCustomer = initialFocusId
    ? [...customers, ...archivedCustomers].find((customer) => customer.id === initialFocusId) ?? null
    : null;
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<SortField>("createdAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [isCreateCustomerOpen, setIsCreateCustomerOpen] = useState(false);
  const [isCreatePaymentOpen, setIsCreatePaymentOpen] = useState(false);
  const [isConfirmPaymentOpen, setIsConfirmPaymentOpen] = useState(false);
  const [isCreateSubscriptionOpen, setIsCreateSubscriptionOpen] = useState(false);
  const [isLinkEboekhoudenOpen, setIsLinkEboekhoudenOpen] = useState(false);
  const [archiveAction, setArchiveAction] = useState<"archive" | "restore">("archive");
  const [isArchiveDialogOpen, setIsArchiveDialogOpen] = useState(false);
  const [isCustomerDrawerOpen, setIsCustomerDrawerOpen] = useState(Boolean(focusedCustomer));
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(
    focusedCustomer?.id ?? null,
  );
  const selectedCustomer = useMemo(() => {
    if (!selectedCustomerId) {
      return null;
    }

    return (
      [...customers, ...archivedCustomers].find((customer) => customer.id === selectedCustomerId) ??
      null
    );
  }, [archivedCustomers, customers, selectedCustomerId]);

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }

    setSortField(field);
    setSortDirection("asc");
  }

  function handleViewChange(value: string) {
    const nextView = parseCustomerView(value);
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", nextView);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  function openArchiveDialog(customer: CustomerFlowRecord, action: "archive" | "restore") {
    setSelectedCustomerId(customer.id);
    setArchiveAction(action);
    setIsArchiveDialogOpen(true);
  }

  const viewCounts = useMemo(
    () => ({
      active: customers.filter(isActiveSubscription).length,
      all: customers.length,
      archived: archivedCustomers.length,
      setup: customers.filter(isSetupCustomer).length,
    }),
    [archivedCustomers, customers],
  );

  const filteredAndSorted = useMemo(() => {
    let result = [...visibleCustomers];

    if (activeView === "setup") {
      result = result.filter(isSetupCustomer);
    }

    if (activeView === "active") {
      result = result.filter(isActiveSubscription);
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter((customer) =>
        [customer.businessName, customer.contactName, customer.email]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(query),
      );
    }

    result.sort((left, right) => {
      let comparison = 0;

      switch (sortField) {
        case "businessName":
          comparison = getCustomerDisplayName(left).localeCompare(getCustomerDisplayName(right));
          break;
        case "contactName":
          comparison = (left.contactName ?? "").localeCompare(right.contactName ?? "");
          break;
        case "status":
          comparison =
            activeView === "active"
              ? (left.latestSubscriptionStatus ?? "").localeCompare(
                  right.latestSubscriptionStatus ?? "",
                )
              : statusOrder[getCustomerStage(left)] - statusOrder[getCustomerStage(right)];
          break;
        case "subscriptionAmount":
          comparison =
            Number(left.latestSubscriptionAmountValue ?? 0) -
            Number(right.latestSubscriptionAmountValue ?? 0);
          break;
        case "subscriptionInterval":
          comparison = (left.latestSubscriptionInterval ?? "").localeCompare(
            right.latestSubscriptionInterval ?? "",
          );
          break;
        case "nextPaymentDate":
          comparison =
            new Date(left.latestSubscriptionNextPaymentDate ?? 0).getTime() -
            new Date(right.latestSubscriptionNextPaymentDate ?? 0).getTime();
          break;
        default:
          comparison =
            new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
      }

      return sortDirection === "asc" ? comparison : -comparison;
    });

    return result;
  }, [activeView, searchQuery, sortField, sortDirection, visibleCustomers]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 p-8">
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Action failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {notice ? (
        <Alert>
          <AlertTitle>Updated</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Customers</h2>
          <p className="text-muted-foreground mt-2">
            Manage your customers and their subscriptions.
          </p>
        </div>
        <Button onClick={() => setIsCreateCustomerOpen(true)}>
          <Plus />
          Add Customer
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative min-w-[220px] flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search customers..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            className="pl-9"
          />
        </div>
        <Tabs value={activeView} onValueChange={handleViewChange}>
          <TabsList>
            {CUSTOMER_VIEWS.map((view) => (
              <TabsTrigger key={view.value} value={view.value}>
                {view.label}
                <span className="ml-2 text-xs text-muted-foreground">
                  {viewCounts[view.value]}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <div className="overflow-hidden rounded-md border bg-card">
        <Table className="w-full min-w-0 table-fixed border-collapse">
          <TableHeader>
            <TableRow>
              {activeView === "active" ? (
                <>
                  <TableHead className="w-[17%]">
                    <button
                      type="button"
                      onClick={() => handleSort("businessName")}
                      className="inline-flex min-w-0 items-center transition-colors hover:text-foreground"
                    >
                      Business
                      <SortIcon field="businessName" sortDirection={sortDirection} sortField={sortField} />
                    </button>
                  </TableHead>
                  <TableHead className="w-[23%]">
                    <button
                      type="button"
                      onClick={() => handleSort("contactName")}
                      className="inline-flex min-w-0 items-center transition-colors hover:text-foreground"
                    >
                      Contact
                      <SortIcon field="contactName" sortDirection={sortDirection} sortField={sortField} />
                    </button>
                  </TableHead>
                  <TableHead className="w-[11%] text-right">
                    <button
                      type="button"
                      onClick={() => handleSort("subscriptionAmount")}
                      className="inline-flex min-w-0 w-full items-center justify-end transition-colors hover:text-foreground"
                    >
                      Amount
                      <SortIcon
                        field="subscriptionAmount"
                        sortDirection={sortDirection}
                        sortField={sortField}
                      />
                    </button>
                  </TableHead>
                  <TableHead className="w-[10%]">
                    <button
                      type="button"
                      onClick={() => handleSort("subscriptionInterval")}
                      className="inline-flex min-w-0 items-center transition-colors hover:text-foreground"
                    >
                      Period
                      <SortIcon
                        field="subscriptionInterval"
                        sortDirection={sortDirection}
                        sortField={sortField}
                      />
                    </button>
                  </TableHead>
                  <TableHead className="w-[14%]">
                    <button
                      type="button"
                      onClick={() => handleSort("nextPaymentDate")}
                      className="inline-flex min-w-0 items-center transition-colors hover:text-foreground"
                    >
                      Next payment
                      <SortIcon
                        field="nextPaymentDate"
                        sortDirection={sortDirection}
                        sortField={sortField}
                      />
                    </button>
                  </TableHead>
                  <TableHead className="w-[19%]">
                    <button
                      type="button"
                      onClick={() => handleSort("status")}
                      className="inline-flex min-w-0 items-center transition-colors hover:text-foreground"
                    >
                      Status
                      <SortIcon field="status" sortDirection={sortDirection} sortField={sortField} />
                    </button>
                  </TableHead>
                  <TableHead className="w-[6%] px-2 text-right" />
                </>
              ) : (
                <>
                  <TableHead className="w-[17%]">
                    <button
                      type="button"
                      onClick={() => handleSort("businessName")}
                      className="inline-flex min-w-0 items-center transition-colors hover:text-foreground"
                    >
                      Business
                      <SortIcon field="businessName" sortDirection={sortDirection} sortField={sortField} />
                    </button>
                  </TableHead>
                  <TableHead className="w-[25%]">
                    <button
                      type="button"
                      onClick={() => handleSort("contactName")}
                      className="inline-flex min-w-0 items-center transition-colors hover:text-foreground"
                    >
                      Contact
                      <SortIcon field="contactName" sortDirection={sortDirection} sortField={sortField} />
                    </button>
                  </TableHead>
                  <TableHead className="w-[10%] text-right">
                    <button
                      type="button"
                      onClick={() => handleSort("subscriptionAmount")}
                      className="inline-flex min-w-0 w-full items-center justify-end transition-colors hover:text-foreground"
                    >
                      Amount
                      <SortIcon
                        field="subscriptionAmount"
                        sortDirection={sortDirection}
                        sortField={sortField}
                      />
                    </button>
                  </TableHead>
                  <TableHead className="w-[13%]">
                    <button
                      type="button"
                      onClick={() => handleSort("nextPaymentDate")}
                      className="inline-flex min-w-0 items-center transition-colors hover:text-foreground"
                    >
                      Next payment
                      <SortIcon
                        field="nextPaymentDate"
                        sortDirection={sortDirection}
                        sortField={sortField}
                      />
                    </button>
                  </TableHead>
                  <TableHead className="w-[18%]">
                    <button
                      type="button"
                      onClick={() => handleSort("status")}
                      className="inline-flex min-w-0 items-center transition-colors hover:text-foreground"
                    >
                      Status
                      <SortIcon field="status" sortDirection={sortDirection} sortField={sortField} />
                    </button>
                  </TableHead>
                  <TableHead className="w-[11%]">
                    <button
                      type="button"
                      onClick={() => handleSort("createdAt")}
                      className="inline-flex min-w-0 items-center transition-colors hover:text-foreground"
                    >
                      Created
                      <SortIcon field="createdAt" sortDirection={sortDirection} sortField={sortField} />
                    </button>
                  </TableHead>
                  <TableHead className="w-[6%] px-2 text-right" />
                </>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredAndSorted.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="py-8 text-center text-muted-foreground"
                >
                  {activeView === "archived" && visibleCustomers.length === 0
                    ? "No archived customers."
                    : visibleCustomers.length === 0
                      ? "No customers found. Create one to get started."
                      : "No customers match your filters."}
                </TableCell>
              </TableRow>
            ) : (
              filteredAndSorted.map((customer) => {
                const stage = getCustomerStage(customer);
                const actionKind = getActionKind(customer);
                const isArchived = Boolean(customer.archivedAt);

                return (
                  <TableRow
                    key={customer.id}
                    className={cn(
                      !isArchived &&
                        actionKind === "create_subscription" &&
                        "bg-primary/[0.03] hover:bg-primary/[0.06]",
                      initialFocusId === customer.id && "bg-accent/40",
                    )}
                  >
                    <TableCell
                      className={cn(
                        "font-medium",
                        !isArchived &&
                          actionKind === "create_subscription" &&
                          "border-l-2 border-l-primary/70",
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate" title={getCustomerDisplayName(customer)}>
                          {getCustomerDisplayName(customer)}
                        </span>
                        {isArchived ? (
                          <Badge variant="secondary" className="shrink-0">
                            Archived
                          </Badge>
                        ) : null}
                        {customer.eboekhoudenLinkStatus === "unlinked" ? (
                          <span
                            className="inline-flex shrink-0 text-muted-foreground/70"
                            title="Not linked to e-Boekhouden"
                          >
                            <Unlink className="size-3.5" aria-hidden="true" />
                            <span className="sr-only">Not linked to e-Boekhouden</span>
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex min-w-0 flex-col gap-1">
                        <span className="truncate" title={customer.contactName ?? undefined}>
                          {customer.contactName ?? "-"}
                        </span>
                        <span className="truncate text-sm text-muted-foreground" title={customer.email}>
                          {customer.email}
                        </span>
                      </div>
                    </TableCell>
                    {activeView === "active" ? (
                      <>
                        <TableCell className="text-right font-medium">
                          {formatSubscriptionAmount(customer)}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatSubscriptionInterval(customer.latestSubscriptionInterval)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {formatTableDate(customer.latestSubscriptionNextPaymentDate)}
                        </TableCell>
                        <TableCell>{getSubscriptionStatusBadge(customer)}</TableCell>
                      </>
                    ) : (
                      <>
                        <TableCell className="text-right font-medium">
                          {formatSubscriptionAmount(customer)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {formatTableDate(customer.latestSubscriptionNextPaymentDate)}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-2">
                            {getCustomerLifecycleBadge(customer)}
                            {getStatusBadge(stage)}
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {formatDate(customer.createdAt)}
                        </TableCell>
                      </>
                    )}
                    <TableCell className="px-2 text-right">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className={cn(
                          "relative",
                          !isArchived &&
                            actionKind === "create_subscription" &&
                            "bg-primary/10 text-primary ring-1 ring-primary/40 hover:bg-primary/15",
                        )}
                        onClick={() => {
                          setSelectedCustomerId(customer.id);
                          setIsCustomerDrawerOpen(true);
                        }}
                      >
                        <ChevronRight />
                        <span className="sr-only">
                          {actionKind === "create_subscription"
                            ? "View customer details. Ready to create subscription."
                            : actionKind === "activation_pending"
                              ? "View customer details. Automatic subscription activation is pending."
                            : "View customer details"}
                        </span>
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <CustomerDrawer
        customer={selectedCustomer}
        open={isCustomerDrawerOpen && selectedCustomer !== null}
        onOpenChange={setIsCustomerDrawerOpen}
        onOpenCreatePayment={(customer) => {
          setIsCustomerDrawerOpen(false);
          setSelectedCustomerId(customer.id);
          setTimeout(() => setIsCreatePaymentOpen(true), 150);
        }}
        onOpenConfirmPayment={(customer) => {
          setIsCustomerDrawerOpen(false);
          setSelectedCustomerId(customer.id);
          setTimeout(() => setIsConfirmPaymentOpen(true), 150);
        }}
        onOpenLinkEboekhouden={(customer) => {
          setIsCustomerDrawerOpen(false);
          setSelectedCustomerId(customer.id);
          setTimeout(() => setIsLinkEboekhoudenOpen(true), 150);
        }}
        onOpenCreateSubscription={(customer) => {
          setIsCustomerDrawerOpen(false);
          setSelectedCustomerId(customer.id);
          setTimeout(() => setIsCreateSubscriptionOpen(true), 150);
        }}
        onOpenArchiveCustomer={(customer) => {
          setIsCustomerDrawerOpen(false);
          setTimeout(() => openArchiveDialog(customer, "archive"), 150);
        }}
        onOpenRestoreCustomer={(customer) => {
          setIsCustomerDrawerOpen(false);
          setTimeout(() => openArchiveDialog(customer, "restore"), 150);
        }}
      />

      <CustomerArchiveDialog
        action={archiveAction}
        customer={selectedCustomer}
        open={isArchiveDialogOpen}
        onOpenChange={setIsArchiveDialogOpen}
        returnTo={returnTo}
      />

      <CreateCustomerDialog open={isCreateCustomerOpen} onOpenChange={setIsCreateCustomerOpen} />

      <CreatePaymentLinkDialog
        key={`customers-payment-${selectedCustomer?.id ?? "none"}-${Number(isCreatePaymentOpen)}`}
        customer={selectedCustomer}
        customers={customers}
        open={isCreatePaymentOpen}
        onOpenChange={setIsCreatePaymentOpen}
      />

      <ConfirmPaymentDialog
        key={`customers-confirm-${selectedCustomer?.id ?? "none"}-${Number(isConfirmPaymentOpen)}`}
        customer={selectedCustomer}
        open={isConfirmPaymentOpen}
        onOpenChange={setIsConfirmPaymentOpen}
      />

      <LinkEboekhoudenRelationDialog
        key={`customers-eboekhouden-${selectedCustomer?.id ?? "none"}-${Number(
          isLinkEboekhoudenOpen,
        )}`}
        customer={selectedCustomer}
        open={isLinkEboekhoudenOpen}
        onOpenChange={setIsLinkEboekhoudenOpen}
      />

      <CreateSubscriptionDialog
        key={`customers-subscription-${selectedCustomer?.id ?? "none"}-${Number(
          isCreateSubscriptionOpen,
        )}`}
        customer={selectedCustomer}
        open={isCreateSubscriptionOpen}
        onOpenChange={setIsCreateSubscriptionOpen}
      />
    </div>
  );
}
