import type { PaymentOverview, SubscriptionOverview } from "./onboarding/data";

type RevenueSubscription = Pick<
  SubscriptionOverview,
  | "amountValue"
  | "amountCurrency"
  | "interval"
  | "localStatus"
  | "mollieStatus"
  | "serviceEndAt"
  | "stopAfterCurrentPeriod"
  | "canceledAt"
>;
type RevenuePayment = Pick<
  PaymentOverview,
  "amountValue" | "amountCurrency" | "mollieStatus" | "paidAt"
>;

export type RevenueMonth = {
  key: string;
  label: string;
  total: number;
  paymentCount: number;
};
export type CurrencyRevenue = {
  currency: string;
  monthlyRecurringRevenue: number;
  recurringSubscriptionCount: number;
  excludedSubscriptionCount: number;
  undatedPaymentCount: number;
  months: RevenueMonth[];
};

const calendarFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Amsterdam",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function dashboardCalendarDate(date: Date) {
  const parts = calendarFormatter.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** Monthly equivalent of the subscription charge, before rounding the combined total. */
export function monthlySubscriptionAmount(
  amountValue: string,
  interval: string,
): number | null {
  if (!amountValue.trim()) return null;
  const amount = Number(amountValue);
  if (!Number.isFinite(amount) || amount < 0) return null;
  const normalized = interval.trim().toLowerCase();
  const aliases: Record<string, string> = {
    monthly: "1 month",
    yearly: "1 year",
    weekly: "1 week",
  };
  const match = /^(\d+)\s+(day|week|month|year)s?$/.exec(
    aliases[normalized] ?? normalized,
  );
  if (!match || Number(match[1]) <= 0) return null;
  const count = Number(match[1]);
  switch (match[2]) {
    case "year":
      return amount / (count * 12);
    case "month":
      return amount / count;
    case "week":
      return (amount * 52) / (count * 12);
    case "day":
      return (amount * 365) / (count * 12);
    default:
      return null;
  }
}

export function isCurrentRecurringSubscription(
  subscription: RevenueSubscription,
  now: Date,
) {
  return (
    subscription.localStatus === "active" &&
    (subscription.mollieStatus === "active" ||
      subscription.mollieStatus === null) &&
    !subscription.stopAfterCurrentPeriod &&
    !subscription.canceledAt &&
    // startDate is the first recurring charge, which may follow an upfront installment.
    (!subscription.serviceEndAt ||
      Date.parse(subscription.serviceEndAt) > now.getTime())
  );
}

export function buildDashboardRevenue(
  subscriptions: readonly RevenueSubscription[],
  payments: readonly RevenuePayment[],
  now = new Date(),
): CurrencyRevenue[] {
  const [year, month] = dashboardCalendarDate(now).split("-").map(Number);
  const monthTemplate = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 6 + index, 1));
    return {
      key: date.toISOString().slice(0, 7),
      label: new Intl.DateTimeFormat("en-GB", {
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }).format(date),
      total: 0,
      paymentCount: 0,
    };
  });
  const currencies = new Map<string, CurrencyRevenue>();
  function getCurrency(currency: string) {
    let revenue = currencies.get(currency);
    if (!revenue) {
      revenue = {
        currency,
        monthlyRecurringRevenue: 0,
        recurringSubscriptionCount: 0,
        excludedSubscriptionCount: 0,
        undatedPaymentCount: 0,
        months: monthTemplate.map((entry) => ({ ...entry })),
      };
      currencies.set(currency, revenue);
    }
    return revenue;
  }

  for (const subscription of subscriptions) {
    if (!isCurrentRecurringSubscription(subscription, now)) continue;
    const revenue = getCurrency(subscription.amountCurrency);
    const monthly = monthlySubscriptionAmount(
      subscription.amountValue,
      subscription.interval,
    );
    if (monthly === null) {
      revenue.excludedSubscriptionCount++;
      continue;
    }
    revenue.monthlyRecurringRevenue += monthly;
    revenue.recurringSubscriptionCount++;
  }

  for (const payment of payments) {
    if (payment.mollieStatus !== "paid") continue;
    const revenue = getCurrency(payment.amountCurrency);
    const paidAt = payment.paidAt ? new Date(payment.paidAt) : null;
    if (!paidAt || !Number.isFinite(paidAt.getTime())) {
      revenue.undatedPaymentCount++;
      continue;
    }
    if (paidAt > now) continue;
    const bucket = revenue.months.find(
      (entry) => entry.key === dashboardCalendarDate(paidAt).slice(0, 7),
    );
    const amount = Number(payment.amountValue);
    if (
      bucket &&
      payment.amountValue.trim() &&
      Number.isFinite(amount) &&
      amount >= 0
    ) {
      bucket.total += amount;
      bucket.paymentCount++;
    }
  }

  if (!currencies.size) getCurrency("EUR");
  return [...currencies.values()]
    .map((revenue) => ({
      ...revenue,
      monthlyRecurringRevenue:
        Math.round(revenue.monthlyRecurringRevenue * 100) / 100,
      months: revenue.months.map((entry) => ({
        ...entry,
        total: Math.round(entry.total * 100) / 100,
      })),
    }))
    .sort((a, b) =>
      a.currency === b.currency
        ? 0
        : a.currency === "EUR"
          ? -1
          : b.currency === "EUR"
            ? 1
            : a.currency.localeCompare(b.currency),
    );
}
