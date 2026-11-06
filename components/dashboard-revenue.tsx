"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Info } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CurrencyRevenue } from "@/lib/dashboard-metrics";
import { formatCurrency } from "@/lib/format";

function compactChartAmount(value: number) {
  // Fixed suffixes keep server and browser output identical across ICU versions.
  const [divisor, suffix] =
    value >= 1e9
      ? ([1e9, "B"] as const)
      : value >= 1e6
        ? ([1e6, "M"] as const)
        : value >= 1e3
          ? ([1e3, "K"] as const)
          : ([1, ""] as const);
  return `${(value / divisor).toFixed(1).replace(/\.0$/, "")}${suffix}`;
}

export function DashboardRevenue({
  revenues,
  isTestMode,
}: Readonly<{
  revenues: CurrencyRevenue[];
  isTestMode: boolean;
}>) {
  const [currency, setCurrency] = useState(revenues[0].currency);
  const revenue =
    revenues.find((item) => item.currency === currency) ?? revenues[0];
  const currentMonth = revenue.months[5];
  const previousMonth = revenue.months[4];
  const maximum = Math.max(...revenue.months.map((month) => month.total), 1);
  const money = (value: number) => formatCurrency(value, revenue.currency);

  return (
    <Card className="overflow-hidden">
      <CardContent className="grid p-0 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="flex flex-col border-b bg-muted/30 p-6 sm:p-8 lg:border-r lg:border-b-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-medium text-muted-foreground">
              Monthly recurring revenue
            </h2>
            {isTestMode && <Badge variant="outline">Test data</Badge>}
          </div>
          <div className="mt-6 flex flex-wrap items-baseline gap-x-2">
            <p className="break-all text-4xl font-semibold tracking-tight tabular-nums sm:text-5xl xl:text-6xl">
              {money(revenue.monthlyRecurringRevenue)}
            </p>
            <span className="text-sm text-muted-foreground">/ month</span>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            From {revenue.recurringSubscriptionCount} current recurring{" "}
            {revenue.recurringSubscriptionCount === 1
              ? "subscription"
              : "subscriptions"}
            .
          </p>
          <details className="mt-5 mb-6 text-xs leading-5 text-muted-foreground">
            <summary className="w-fit cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-ring">
              <Info className="mr-1 inline h-3.5 w-3.5" /> How this is
              calculated
            </summary>
            <p className="mt-2 max-w-sm">
              Active subscriptions at their stored billing amounts, normalized
              to a month. Yearly ÷ 12; weekly × 52 ÷ 12. Pending, paused,
              stopped and ended subscriptions are excluded. This is a recurring
              billing estimate, not collected cash or net revenue after taxes,
              refunds and fees.
            </p>
          </details>
          {revenue.excludedSubscriptionCount > 0 && (
            <p className="mb-4 text-xs text-destructive">
              {revenue.excludedSubscriptionCount} active{" "}
              {revenue.excludedSubscriptionCount === 1
                ? "subscription has"
                : "subscriptions have"}{" "}
              an unsupported amount or interval and could not be included.
            </p>
          )}
          <div className="mt-auto grid grid-cols-2 gap-4 border-t pt-5">
            <div>
              <p className="text-xs text-muted-foreground">
                Collected this month
              </p>
              <p className="mt-2 text-xl font-semibold tracking-tight tabular-nums">
                {money(currentMonth.total)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {currentMonth.paymentCount} paid{" "}
                {currentMonth.paymentCount === 1 ? "payment" : "payments"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">
                Collected last month
              </p>
              <p className="mt-2 text-xl font-semibold tracking-tight tabular-nums">
                {money(previousMonth.total)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {previousMonth.label}
              </p>
            </div>
          </div>
        </div>
        <div className="min-w-0 p-6 sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold">Payment collections</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Last 6 months · current month to date
              </p>
            </div>
            {revenues.length > 1 ? (
              <Select value={revenue.currency} onValueChange={setCurrency}>
                <SelectTrigger aria-label="Revenue currency" className="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {revenues.map((item) => (
                    <SelectItem key={item.currency} value={item.currency}>
                      {item.currency}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Badge variant="outline">{revenue.currency}</Badge>
            )}
          </div>
          <div className="relative mt-8">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-5 bottom-7 flex flex-col justify-between"
            >
              {[0, 1, 2].map((line) => (
                <div
                  key={line}
                  className="border-t border-dashed border-border/70"
                />
              ))}
            </div>
            <ol
              aria-label={`Monthly collected payments in ${revenue.currency}`}
              className="relative grid grid-cols-6 gap-2 sm:gap-4"
            >
              {revenue.months.map((month, index) => (
                <li key={month.key} className="min-w-0">
                  <div className="flex h-48 flex-col justify-end">
                    <span
                      className="mb-2 text-center text-xs font-medium tabular-nums"
                      title={money(month.total)}
                    >
                      <span aria-hidden="true">
                        {compactChartAmount(month.total)}
                      </span>
                      <span className="sr-only">{money(month.total)}</span>
                    </span>
                    <div
                      aria-hidden="true"
                      className={`mx-auto w-full max-w-12 rounded-t-sm ${index === 5 ? "bg-primary" : "bg-primary/20"}`}
                      style={{
                        height:
                          month.total > 0
                            ? `${Math.max(2, (month.total / maximum) * 150)}px`
                            : "2px",
                      }}
                    />
                  </div>
                  <p
                    className={`border-t pt-3 text-center text-xs ${index === 5 ? "font-semibold" : "text-muted-foreground"}`}
                  >
                    <span aria-hidden="true">{month.label.split(" ")[0]}</span>
                    <span className="sr-only">{month.label}</span>
                  </p>
                </li>
              ))}
            </ol>
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {revenue.months.every((month) => month.paymentCount === 0)
                ? "Your paid payments will appear here."
                : "Gross paid amounts · by payment date"}
            </p>
            <Button asChild variant="ghost" size="sm">
              <Link href="/payments">
                View payments <ArrowUpRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
          {revenue.undatedPaymentCount > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              {revenue.undatedPaymentCount} paid{" "}
              {revenue.undatedPaymentCount === 1
                ? "payment is"
                : "payments are"}{" "}
              missing a payment date and excluded from the chart.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
