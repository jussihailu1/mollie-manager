import { z } from "zod";

export const FIRST_PAYMENT_INVOICE_STATES = [
  "not_applicable",
  "pending_invoice",
  "invoice_creating",
  "invoice_created",
  "invoice_sent",
  "invoice_failed",
  "skipped",
] as const;

export const RECURRING_INVOICE_STATES = [
  "pending_invoice",
  "invoice_creating",
  "invoice_created",
  "invoice_sent",
  "invoice_failed",
  "skipped",
  "canceled",
] as const;

export type FirstPaymentInvoiceState =
  (typeof FIRST_PAYMENT_INVOICE_STATES)[number];
export type RecurringInvoiceState = (typeof RECURRING_INVOICE_STATES)[number];

export type InvoiceStateCountMap<TState extends string> = Record<TState, number>;

export type InvoiceStateDeltaEntry<TState extends string> = {
  after: number;
  before: number;
  delta: number;
  state: TState;
};

export type InvoiceStateDeltaSummary<TState extends string> = {
  changed: Array<InvoiceStateDeltaEntry<TState>>;
  totalAfter: number;
  totalBefore: number;
  totalDelta: number;
};

export type ReconciliationSummary = {
  firstPaymentInvoiceStateDelta: InvoiceStateDeltaSummary<FirstPaymentInvoiceState>;
  firstPaymentsChecked: number;
  mode: "live" | "test" | null;
  paymentLinksChecked: number;
  ranAt: string;
  reconciliationMode: "full" | "sync_only";
  recurringInvoiceStateDelta: InvoiceStateDeltaSummary<RecurringInvoiceState>;
  subscriptionsChecked: number;
};

function createEmptyStateCounts<TState extends string>(
  states: readonly TState[],
): InvoiceStateCountMap<TState> {
  return Object.fromEntries(states.map((state) => [state, 0])) as InvoiceStateCountMap<TState>;
}

export function buildInvoiceStateDeltaSummary<TState extends string>(
  states: readonly TState[],
  before: Partial<Record<TState, number>>,
  after: Partial<Record<TState, number>>,
): InvoiceStateDeltaSummary<TState> {
  let totalBefore = 0;
  let totalAfter = 0;
  const changed: Array<InvoiceStateDeltaEntry<TState>> = [];

  for (const state of states) {
    const beforeCount = before[state] ?? 0;
    const afterCount = after[state] ?? 0;
    const delta = afterCount - beforeCount;

    totalBefore += beforeCount;
    totalAfter += afterCount;

    if (delta !== 0) {
      changed.push({
        after: afterCount,
        before: beforeCount,
        delta,
        state,
      });
    }
  }

  return {
    changed,
    totalAfter,
    totalBefore,
    totalDelta: totalAfter - totalBefore,
  };
}

export function mapInvoiceStateCounts<TState extends string>(
  states: readonly TState[],
  rows: Array<{ count: number | string; state: TState }>,
): InvoiceStateCountMap<TState> {
  const counts = createEmptyStateCounts(states);

  for (const row of rows) {
    counts[row.state] =
      typeof row.count === "number" ? row.count : Number(row.count);
  }

  return counts;
}

const firstPaymentInvoiceStateSchema = z.enum(FIRST_PAYMENT_INVOICE_STATES);
const recurringInvoiceStateSchema = z.enum(RECURRING_INVOICE_STATES);

const firstPaymentDeltaEntrySchema = z.object({
  after: z.number().int(),
  before: z.number().int(),
  delta: z.number().int(),
  state: firstPaymentInvoiceStateSchema,
});

const recurringDeltaEntrySchema = z.object({
  after: z.number().int(),
  before: z.number().int(),
  delta: z.number().int(),
  state: recurringInvoiceStateSchema,
});

const firstPaymentDeltaSummarySchema = z.object({
  changed: z.array(firstPaymentDeltaEntrySchema),
  totalAfter: z.number().int(),
  totalBefore: z.number().int(),
  totalDelta: z.number().int(),
});

const recurringDeltaSummarySchema = z.object({
  changed: z.array(recurringDeltaEntrySchema),
  totalAfter: z.number().int(),
  totalBefore: z.number().int(),
  totalDelta: z.number().int(),
});

const reconciliationSummarySchema = z.object({
  firstPaymentInvoiceStateDelta: firstPaymentDeltaSummarySchema,
  firstPaymentsChecked: z.number().int().nonnegative(),
  mode: z.enum(["live", "test"]).nullable(),
  paymentLinksChecked: z.number().int().nonnegative(),
  ranAt: z.string().datetime(),
  reconciliationMode: z.enum(["full", "sync_only"]),
  recurringInvoiceStateDelta: recurringDeltaSummarySchema,
  subscriptionsChecked: z.number().int().nonnegative(),
});

export function serializeReconciliationSummary(
  summary: ReconciliationSummary,
): string {
  return Buffer.from(JSON.stringify(summary), "utf8").toString("base64url");
}

export function parseReconciliationSummary(
  value: string | null | undefined,
): ReconciliationSummary | null {
  if (!value) {
    return null;
  }

  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    const parsed = JSON.parse(decoded);
    const result = reconciliationSummarySchema.safeParse(parsed);

    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
