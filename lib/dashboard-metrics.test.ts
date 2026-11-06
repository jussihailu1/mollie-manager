import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildDashboardRevenue,
  dashboardCalendarDate,
  monthlySubscriptionAmount,
} from "./dashboard-metrics";

const now = new Date("2026-11-06T12:00:00Z");
const subscription = {
  amountValue: "120.00",
  amountCurrency: "EUR",
  interval: "1 month",
  localStatus: "active",
  mollieStatus: "active",
  startDate: "2026-12-01",
  serviceEndAt: null,
  stopAfterCurrentPeriod: false,
  canceledAt: null,
};
const payment = {
  amountValue: "75.00",
  amountCurrency: "EUR",
  mollieStatus: "paid",
  paidAt: "2026-11-02T12:00:00Z",
};

describe("dashboard recurring revenue", () => {
  it("normalizes yearly, quarterly, monthly, weekly and daily billing", () => {
    assert.equal(monthlySubscriptionAmount("1200", "12 months"), 100);
    assert.equal(monthlySubscriptionAmount("1200", "yearly"), 100);
    assert.equal(monthlySubscriptionAmount("2400", "2 years"), 100);
    assert.equal(monthlySubscriptionAmount("300", "3 months"), 100);
    assert.equal(monthlySubscriptionAmount("100", "monthly"), 100);
    assert.equal(monthlySubscriptionAmount("30", "1 week"), 130);
    assert.equal(monthlySubscriptionAmount("60", "2 weeks"), 130);
    assert.equal(monthlySubscriptionAmount("12", "1 day"), 365);
  });

  it("rejects unknown intervals and invalid amounts without inflating the total", () => {
    for (const interval of [
      "",
      "0 months",
      "-1 month",
      "sometimes",
      "1.5 months",
    ]) {
      assert.equal(monthlySubscriptionAmount("10", interval), null);
    }
    for (const amount of ["", " ", "no", "Infinity", "-50"]) {
      assert.equal(monthlySubscriptionAmount(amount, "1 month"), null);
    }
    assert.equal(monthlySubscriptionAmount("0", "1 month"), 0);
    const [result] = buildDashboardRevenue(
      [{ ...subscription, interval: "unknown" }],
      [],
      now,
    );
    assert.equal(result.monthlyRecurringRevenue, 0);
    assert.equal(result.excludedSubscriptionCount, 1);
  });

  it("counts every active subscription, even when its next recurring charge is in the future", () => {
    const [result] = buildDashboardRevenue(
      [
        subscription,
        { ...subscription, interval: "12 months", amountValue: "1200.00" },
      ],
      [],
      now,
    );
    assert.equal(result.monthlyRecurringRevenue, 220);
    assert.equal(result.recurringSubscriptionCount, 2);
  });

  it("excludes pending, suspended, cancelled, stopped and expired subscriptions", () => {
    const [result] = buildDashboardRevenue(
      [
        subscription,
        { ...subscription, localStatus: "mandate_pending" },
        { ...subscription, mollieStatus: "pending" },
        { ...subscription, mollieStatus: "suspended" },
        { ...subscription, mollieStatus: "canceled" },
        { ...subscription, mollieStatus: "completed" },
        { ...subscription, localStatus: "payment_action_required" },
        { ...subscription, stopAfterCurrentPeriod: true },
        { ...subscription, canceledAt: "2026-11-01T00:00:00Z" },
        { ...subscription, serviceEndAt: "2026-11-06T12:00:00Z" },
      ],
      [],
      now,
    );
    assert.equal(result.monthlyRecurringRevenue, 120);
    assert.equal(result.recurringSubscriptionCount, 1);
  });

  it("rounds after combining normalized subscription amounts", () => {
    const [result] = buildDashboardRevenue(
      Array.from({ length: 12 }, () => ({
        ...subscription,
        amountValue: "100.00",
        interval: "12 months",
      })),
      [],
      now,
    );
    assert.equal(result.monthlyRecurringRevenue, 100);
  });

  it("never combines different currencies", () => {
    const result = buildDashboardRevenue(
      [{ ...subscription, amountCurrency: "USD" }, subscription],
      [{ ...payment, amountCurrency: "GBP" }],
      now,
    );
    assert.deepEqual(
      result.map((entry) => [
        entry.currency,
        entry.monthlyRecurringRevenue,
        entry.months[5].total,
      ]),
      [
        ["EUR", 120, 0],
        ["GBP", 0, 75],
        ["USD", 120, 0],
      ],
    );
  });
});

describe("dashboard payment collections", () => {
  it("uses paid timestamps and Amsterdam month boundaries, excluding unpaid and future payments", () => {
    const [result] = buildDashboardRevenue(
      [],
      [
        payment,
        { ...payment, paidAt: "2026-10-31T23:30:00Z" }, // November in Amsterdam.
        { ...payment, paidAt: "2026-10-31T22:30:00Z" },
        { ...payment, paidAt: "2026-12-01T00:00:00Z" },
        { ...payment, mollieStatus: "failed" },
        { ...payment, mollieStatus: "open" },
        { ...payment, paidAt: null },
        { ...payment, paidAt: "invalid" },
        { ...payment, paidAt: "2026-01-01T00:00:00Z" },
      ],
      now,
    );
    assert.equal(result.months[5].total, 150);
    assert.equal(result.months[5].paymentCount, 2);
    assert.equal(result.months[4].total, 75);
    assert.equal(result.undatedPaymentCount, 2);
    assert.equal(result.monthlyRecurringRevenue, 0);
  });

  it("keeps yearly cash payments intact in the collections chart", () => {
    const [result] = buildDashboardRevenue(
      [{ ...subscription, amountValue: "1200", interval: "12 months" }],
      [{ ...payment, amountValue: "1200" }],
      now,
    );
    assert.equal(result.monthlyRecurringRevenue, 100);
    assert.equal(result.months[5].total, 1200);
  });

  it("provides six empty calendar months, including across year boundaries", () => {
    const [result] = buildDashboardRevenue(
      [],
      [],
      new Date("2026-01-15T12:00:00Z"),
    );
    assert.equal(result.currency, "EUR");
    assert.equal(result.monthlyRecurringRevenue, 0);
    assert.deepEqual(
      result.months.map((entry) => entry.key),
      ["2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01"],
    );
    assert.ok(
      result.months.every(
        (entry) => entry.total === 0 && entry.paymentCount === 0,
      ),
    );
    assert.equal(
      dashboardCalendarDate(new Date("2026-03-31T22:30:00Z")),
      "2026-04-01",
    );
  });
});
