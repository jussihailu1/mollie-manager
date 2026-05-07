"use client";

import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Calendar,
  CheckCircle,
  DollarSign,
  Download,
  Plus,
  Search,
  TrendingUp,
} from "lucide-react";

import { type CustomerFlowRecord, CreatePaymentLinkDialog } from "@/components/customer-flow-dialogs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { formatCurrency, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

type PaymentRecord = {
  amount: string;
  createdAt: string;
  currency: string;
  customerBusinessName: string;
  customerId: string | null;
  description: string;
  id: string;
  paidAt: string | null;
  reference: string;
  status: "pending" | "paid" | "failed" | "expired";
  type: "first" | "recurring";
};

type SortField =
  | "reference"
  | "customerName"
  | "amount"
  | "paymentType"
  | "mollieStatus"
  | "createdAt"
  | "paidAt";
type SortDirection = "asc" | "desc";

const STATUS_OPTIONS = [
  { label: "All Statuses", value: "all" },
  { label: "Pending", value: "pending" },
  { label: "Paid", value: "paid" },
  { label: "Failed", value: "failed" },
  { label: "Expired", value: "expired" },
] as const;

const TYPE_OPTIONS = [
  { label: "All Types", value: "all" },
  { label: "First Payment", value: "first" },
  { label: "Recurring Payment", value: "recurring" },
] as const;

function getStatusBadge(status: PaymentRecord["status"]) {
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
      return <Badge variant="outline">{status}</Badge>;
  }
}

function getTypeBadge(type: PaymentRecord["type"]) {
  if (type === "first") {
    return <Badge variant="outline">First</Badge>;
  }

  return <Badge variant="secondary">Recurring</Badge>;
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

function getInitialPage(payments: PaymentRecord[], initialFocusId?: string | null) {
  if (!initialFocusId) {
    return 1;
  }

  const sortedPayments = [...payments].sort(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );
  const focusedIndex = sortedPayments.findIndex((payment) => payment.id === initialFocusId);

  if (focusedIndex === -1) {
    return 1;
  }

  return Math.floor(focusedIndex / 10) + 1;
}

export function PaymentsWorkspace({
  customers,
  error,
  initialFocusId,
  notice,
  payments,
}: Readonly<{
  customers: CustomerFlowRecord[];
  error?: string | null;
  initialFocusId?: string | null;
  notice?: string | null;
  payments: PaymentRecord[];
}>) {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortField, setSortField] = useState<SortField>("createdAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [currentPage, setCurrentPage] = useState(() => getInitialPage(payments, initialFocusId));
  const [isCreatePaymentOpen, setIsCreatePaymentOpen] = useState(false);
  const itemsPerPage = 10;

  const filteredAndSorted = useMemo(() => {
    let result = [...payments];

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter((payment) =>
        [
          payment.customerBusinessName,
          payment.description,
          payment.reference,
          payment.id,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(query),
      );
    }

    if (statusFilter !== "all") {
      result = result.filter((payment) => payment.status === statusFilter);
    }

    if (typeFilter !== "all") {
      result = result.filter((payment) => payment.type === typeFilter);
    }

    if (dateFrom) {
      const fromDate = new Date(dateFrom).getTime();
      result = result.filter((payment) => new Date(payment.createdAt).getTime() >= fromDate);
    }

    if (dateTo) {
      const toDate = new Date(dateTo).getTime() + 86_400_000;
      result = result.filter((payment) => new Date(payment.createdAt).getTime() <= toDate);
    }

    result.sort((left, right) => {
      let comparison = 0;

      switch (sortField) {
        case "reference":
          comparison = left.reference.localeCompare(right.reference);
          break;
        case "customerName":
          comparison = left.customerBusinessName.localeCompare(right.customerBusinessName);
          break;
        case "amount":
          comparison = Number(left.amount) - Number(right.amount);
          break;
        case "paymentType":
          comparison = left.type.localeCompare(right.type);
          break;
        case "mollieStatus":
          comparison = left.status.localeCompare(right.status);
          break;
        case "paidAt":
          comparison =
            new Date(left.paidAt ?? 0).getTime() - new Date(right.paidAt ?? 0).getTime();
          break;
        default:
          comparison =
            new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
      }

      return sortDirection === "asc" ? comparison : -comparison;
    });

    return result;
  }, [dateFrom, dateTo, payments, searchQuery, sortDirection, sortField, statusFilter, typeFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredAndSorted.length / itemsPerPage));
  const paginatedPayments = filteredAndSorted.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage,
  );

  const stats = useMemo(() => {
    const paidPayments = payments.filter((payment) => payment.status === "paid");
    const totalRevenue = paidPayments.reduce((sum, payment) => sum + Number(payment.amount), 0);
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const paymentsThisMonth = payments.filter(
      (payment) => new Date(payment.createdAt) >= startOfMonth,
    ).length;
    const nonPending = payments.filter((payment) => payment.status !== "pending");
    const successRate = nonPending.length > 0 ? (paidPayments.length / nonPending.length) * 100 : 0;
    const averagePayment = paidPayments.length > 0 ? totalRevenue / paidPayments.length : 0;
    const primaryCurrency = paidPayments[0]?.currency ?? payments[0]?.currency ?? "EUR";

    return {
      averagePayment,
      paymentsThisMonth,
      primaryCurrency,
      successRate,
      totalRevenue,
    };
  }, [payments]);

  const hasActiveFilters =
    Boolean(searchQuery) ||
    statusFilter !== "all" ||
    typeFilter !== "all" ||
    Boolean(dateFrom) ||
    Boolean(dateTo);

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }

    setSortField(field);
    setSortDirection("asc");
  }

  function handleExportCSV() {
    const headers = [
      "Reference",
      "Customer",
      "Amount",
      "Currency",
      "Type",
      "Status",
      "Created",
      "Paid",
      "Description",
    ];
    const rows = filteredAndSorted.map((payment) => [
      payment.reference,
      `"${payment.customerBusinessName}"`,
      payment.amount,
      payment.currency,
      payment.type,
      payment.status,
      new Date(payment.createdAt).toISOString(),
      payment.paidAt ? new Date(payment.paidAt).toISOString() : "",
      `"${payment.description}"`,
    ]);
    const csvContent = [headers.join(","), ...rows.map((row) => row.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `payments_export_${Date.now()}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  return (
    <div className="p-8 space-y-8 max-w-6xl mx-auto">
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

      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Payments</h2>
          <p className="text-muted-foreground mt-2">Manage and track all your payments.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleExportCSV}>
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
          <Button onClick={() => setIsCreatePaymentOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Create Consent Link
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(stats.totalRevenue, stats.primaryCurrency)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Payments This Month</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.paymentsThisMonth}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Success Rate</CardTitle>
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.successRate.toFixed(1)}%</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Average Payment</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(stats.averagePayment, stats.primaryCurrency)}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search payments..."
              value={searchQuery}
              onChange={(event) => {
                setSearchQuery(event.target.value);
                setCurrentPage(1);
              }}
              className="pl-9"
            />
          </div>
          <Select
            value={statusFilter}
            onValueChange={(value) => {
              setStatusFilter(value);
              setCurrentPage(1);
            }}
          >
            <SelectTrigger className="w-40">
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
          <Select
            value={typeFilter}
            onValueChange={(value) => {
              setTypeFilter(value);
              setCurrentPage(1);
            }}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TYPE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={dateFrom}
              onChange={(event) => {
                setDateFrom(event.target.value);
                setCurrentPage(1);
              }}
              className="w-36"
              aria-label="From Date"
            />
            <span className="text-muted-foreground">-</span>
            <Input
              type="date"
              value={dateTo}
              onChange={(event) => {
                setDateTo(event.target.value);
                setCurrentPage(1);
              }}
              className="w-36"
              aria-label="To Date"
            />
          </div>
          {hasActiveFilters ? (
            <Button
              variant="ghost"
              onClick={() => {
                setSearchQuery("");
                setStatusFilter("all");
                setTypeFilter("all");
                setDateFrom("");
                setDateTo("");
                setCurrentPage(1);
              }}
              className="px-3"
            >
              Clear filters
            </Button>
          ) : null}
        </div>
      </div>

      <div className="border rounded-md bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <button
                  type="button"
                  onClick={() => handleSort("reference")}
                  className="inline-flex items-center hover:text-foreground transition-colors"
                >
                  Reference
                  <SortIcon field="reference" sortDirection={sortDirection} sortField={sortField} />
                </button>
              </TableHead>
              <TableHead>
                <button
                  type="button"
                  onClick={() => handleSort("customerName")}
                  className="inline-flex items-center hover:text-foreground transition-colors"
                >
                  Customer
                  <SortIcon field="customerName" sortDirection={sortDirection} sortField={sortField} />
                </button>
              </TableHead>
              <TableHead>Description</TableHead>
              <TableHead>
                <button
                  type="button"
                  onClick={() => handleSort("paymentType")}
                  className="inline-flex items-center hover:text-foreground transition-colors"
                >
                  Type
                  <SortIcon field="paymentType" sortDirection={sortDirection} sortField={sortField} />
                </button>
              </TableHead>
              <TableHead>
                <button
                  type="button"
                  onClick={() => handleSort("mollieStatus")}
                  className="inline-flex items-center hover:text-foreground transition-colors"
                >
                  Status
                  <SortIcon field="mollieStatus" sortDirection={sortDirection} sortField={sortField} />
                </button>
              </TableHead>
              <TableHead>
                <button
                  type="button"
                  onClick={() => handleSort("createdAt")}
                  className="inline-flex items-center hover:text-foreground transition-colors"
                >
                  Created
                  <SortIcon field="createdAt" sortDirection={sortDirection} sortField={sortField} />
                </button>
              </TableHead>
              <TableHead>
                <button
                  type="button"
                  onClick={() => handleSort("paidAt")}
                  className="inline-flex items-center hover:text-foreground transition-colors"
                >
                  Paid
                  <SortIcon field="paidAt" sortDirection={sortDirection} sortField={sortField} />
                </button>
              </TableHead>
              <TableHead className="text-right">
                <button
                  type="button"
                  onClick={() => handleSort("amount")}
                  className="inline-flex items-center justify-end w-full hover:text-foreground transition-colors"
                >
                  Amount
                  <SortIcon field="amount" sortDirection={sortDirection} sortField={sortField} />
                </button>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedPayments.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  {payments.length === 0
                    ? "No payments found."
                    : "No payments match your filters."}
                </TableCell>
              </TableRow>
            ) : (
              paginatedPayments.map((payment) => (
                <TableRow
                  key={payment.id}
                  className={cn(initialFocusId === payment.id && "bg-accent/40")}
                >
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {payment.reference}
                  </TableCell>
                  <TableCell className="font-medium">{payment.customerBusinessName}</TableCell>
                  <TableCell className="max-w-[200px] truncate" title={payment.description}>
                    {payment.description}
                  </TableCell>
                  <TableCell>{getTypeBadge(payment.type)}</TableCell>
                  <TableCell>{getStatusBadge(payment.status)}</TableCell>
                  <TableCell>{formatDate(payment.createdAt)}</TableCell>
                  <TableCell>
                    {payment.paidAt ? formatDate(payment.paidAt) : "-"}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatCurrency(payment.amount, payment.currency)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 ? (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {(currentPage - 1) * itemsPerPage + 1} to{" "}
            {Math.min(currentPage * itemsPerPage, filteredAndSorted.length)} of{" "}
            {filteredAndSorted.length} payments
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((current) => Math.max(1, current - 1))}
              disabled={currentPage === 1}
            >
              Previous
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {currentPage} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((current) => Math.min(totalPages, current + 1))}
              disabled={currentPage === totalPages}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}

      <CreatePaymentLinkDialog
        key={`payments-create-${Number(isCreatePaymentOpen)}`}
        customer={null}
        customers={customers}
        open={isCreatePaymentOpen}
        onOpenChange={setIsCreatePaymentOpen}
      />
    </div>
  );
}
