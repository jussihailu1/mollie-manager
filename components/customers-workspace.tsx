"use client";

import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronRight,
  Plus,
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
  getCustomerStage,
} from "@/components/customer-flow-dialogs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

type SortField = "businessName" | "contactName" | "status" | "createdAt";
type SortDirection = "asc" | "desc";

const STATUS_OPTIONS = [
  { label: "All Statuses", value: "all" },
  { label: "New", value: "new" },
  { label: "Payment Pending", value: "payment_pending" },
  { label: "Payment Completed", value: "payment_completed" },
  { label: "Subscription Active", value: "subscription_active" },
] as const;

const statusOrder = {
  new: 0,
  payment_pending: 1,
  payment_completed: 2,
  subscription_active: 3,
} as const;

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

  if (stage === "payment_completed") {
    return "create_subscription";
  }

  return "active";
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
  customers,
  error,
  initialFocusId,
  notice,
}: Readonly<{
  customers: CustomerFlowRecord[];
  error?: string | null;
  initialFocusId?: string | null;
  notice?: string | null;
}>) {
  const focusedCustomer = initialFocusId
    ? customers.find((customer) => customer.id === initialFocusId) ?? null
    : null;
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortField, setSortField] = useState<SortField>("createdAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [isCreateCustomerOpen, setIsCreateCustomerOpen] = useState(false);
  const [isCreatePaymentOpen, setIsCreatePaymentOpen] = useState(false);
  const [isConfirmPaymentOpen, setIsConfirmPaymentOpen] = useState(false);
  const [isCreateSubscriptionOpen, setIsCreateSubscriptionOpen] = useState(false);
  const [isLinkEboekhoudenOpen, setIsLinkEboekhoudenOpen] = useState(false);
  const [isCustomerDrawerOpen, setIsCustomerDrawerOpen] = useState(Boolean(focusedCustomer));
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerFlowRecord | null>(focusedCustomer);

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }

    setSortField(field);
    setSortDirection("asc");
  }

  const filteredAndSorted = useMemo(() => {
    let result = [...customers];

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

    if (statusFilter !== "all") {
      result = result.filter((customer) => getCustomerStage(customer) === statusFilter);
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
            statusOrder[getCustomerStage(left)] - statusOrder[getCustomerStage(right)];
          break;
        default:
          comparison =
            new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
      }

      return sortDirection === "asc" ? comparison : -comparison;
    });

    return result;
  }, [customers, searchQuery, statusFilter, sortField, sortDirection]);

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

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search customers..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-hidden rounded-md border bg-card">
        <Table className="min-w-[760px] table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[30%]">
                <button
                  type="button"
                  onClick={() => handleSort("businessName")}
                  className="inline-flex items-center hover:text-foreground transition-colors"
                >
                  Business
                  <SortIcon field="businessName" sortDirection={sortDirection} sortField={sortField} />
                </button>
              </TableHead>
              <TableHead className="w-[30%]">
                <button
                  type="button"
                  onClick={() => handleSort("contactName")}
                  className="inline-flex items-center hover:text-foreground transition-colors"
                >
                  Contact
                  <SortIcon field="contactName" sortDirection={sortDirection} sortField={sortField} />
                </button>
              </TableHead>
              <TableHead className="w-[18%]">
                <button
                  type="button"
                  onClick={() => handleSort("status")}
                  className="inline-flex items-center hover:text-foreground transition-colors"
                >
                  Status
                  <SortIcon field="status" sortDirection={sortDirection} sortField={sortField} />
                </button>
              </TableHead>
              <TableHead className="w-[14%]">
                <button
                  type="button"
                  onClick={() => handleSort("createdAt")}
                  className="inline-flex items-center hover:text-foreground transition-colors"
                >
                  Created
                  <SortIcon field="createdAt" sortDirection={sortDirection} sortField={sortField} />
                </button>
              </TableHead>
              <TableHead className="w-[8%] text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredAndSorted.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  {customers.length === 0
                    ? "No customers found. Create one to get started."
                    : "No customers match your filters."}
                </TableCell>
              </TableRow>
            ) : (
              filteredAndSorted.map((customer) => {
                const stage = getCustomerStage(customer);
                const actionKind = getActionKind(customer);

                return (
                  <TableRow
                    key={customer.id}
                    className={cn(
                      actionKind === "create_subscription" &&
                        "bg-primary/[0.03] hover:bg-primary/[0.06]",
                      initialFocusId === customer.id && "bg-accent/40",
                    )}
                  >
                    <TableCell
                      className={cn(
                        "font-medium",
                        actionKind === "create_subscription" && "border-l-2 border-l-primary/70",
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate" title={getCustomerDisplayName(customer)}>
                          {getCustomerDisplayName(customer)}
                        </span>
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
                    <TableCell>{getStatusBadge(stage)}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDate(customer.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className={cn(
                            "relative",
                            actionKind === "create_subscription" &&
                              "bg-primary/10 text-primary ring-1 ring-primary/40 hover:bg-primary/15",
                          )}
                          onClick={() => {
                            setSelectedCustomer(customer);
                            setIsCustomerDrawerOpen(true);
                          }}
                        >
                          <ChevronRight />
                          <span className="sr-only">
                            {actionKind === "create_subscription"
                              ? "View customer details. Ready to create subscription."
                              : "View customer details"}
                          </span>
                        </Button>
                      </div>
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
        open={isCustomerDrawerOpen}
        onOpenChange={setIsCustomerDrawerOpen}
        onOpenCreatePayment={(customer) => {
          setIsCustomerDrawerOpen(false);
          setSelectedCustomer(customer);
          setTimeout(() => setIsCreatePaymentOpen(true), 150);
        }}
        onOpenConfirmPayment={(customer) => {
          setIsCustomerDrawerOpen(false);
          setSelectedCustomer(customer);
          setTimeout(() => setIsConfirmPaymentOpen(true), 150);
        }}
        onOpenLinkEboekhouden={(customer) => {
          setIsCustomerDrawerOpen(false);
          setSelectedCustomer(customer);
          setTimeout(() => setIsLinkEboekhoudenOpen(true), 150);
        }}
        onOpenCreateSubscription={(customer) => {
          setIsCustomerDrawerOpen(false);
          setSelectedCustomer(customer);
          setTimeout(() => setIsCreateSubscriptionOpen(true), 150);
        }}
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
