export const KIFY_VAT_RATE_BASIS_POINTS = 2100;
export const KIFY_VAT_DENOMINATOR = 12100;

export type KifyInvoiceLineInput = {
  currency: string;
  description: string;
  grossCents: number;
  quantity: number;
  vatRateBasisPoints: number;
};

export type CanonicalKifyInvoiceLine = {
  description: string;
  grossCents: number;
  netCents: number;
  quantity: number;
  unitGrossCents: number;
  vatCents: number;
  vatRateBasisPoints: 0 | 2100;
};

export type CanonicalKifyInvoiceTotals = {
  lines: readonly CanonicalKifyInvoiceLine[];
  subtotalCents: number;
  totalCents: number;
  vatCents: number;
};

function requireIntegerCents(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer cent amount.`);
  }
}

export function calculateVatInclusiveLine(grossCents: number) {
  requireIntegerCents(grossCents, "Gross amount");
  const netCents = Math.floor((grossCents * 10_000 + 6_050) / KIFY_VAT_DENOMINATOR);

  return {
    grossCents,
    netCents,
    vatCents: grossCents - netCents,
  };
}

export function buildCanonicalKifyInvoice(input: {
  lines: readonly KifyInvoiceLineInput[];
  sourceAmountCents: number;
}) : CanonicalKifyInvoiceTotals {
  requireIntegerCents(input.sourceAmountCents, "Source amount");

  if (input.lines.length !== 1) {
    throw new Error("Kify v1 accepts exactly one positive invoice line.");
  }

  const line = input.lines[0]!;
  if (line.currency !== "EUR") {
    throw new Error("Kify v1 supports EUR invoices only.");
  }
  if (line.vatRateBasisPoints !== 0 && line.vatRateBasisPoints !== KIFY_VAT_RATE_BASIS_POINTS) {
    throw new Error("Kify supports KOR or 21% VAT only.");
  }
  if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
    throw new Error("Invoice quantity must be positive.");
  }
  if (!line.description.trim()) {
    throw new Error("Invoice line description is required.");
  }
  requireIntegerCents(line.grossCents, "Line gross amount");

  const money = line.vatRateBasisPoints === 0
    ? { grossCents: line.grossCents, netCents: line.grossCents, vatCents: 0 }
    : calculateVatInclusiveLine(line.grossCents);
  if (money.grossCents !== input.sourceAmountCents) {
    throw new Error("Invoice total must exactly equal the source Mollie amount.");
  }

  return {
    lines: [{
      description: line.description.trim(),
      grossCents: money.grossCents,
      netCents: money.netCents,
      quantity: line.quantity,
      unitGrossCents: money.grossCents,
      vatCents: money.vatCents,
      vatRateBasisPoints: line.vatRateBasisPoints,
    }],
    subtotalCents: money.netCents,
    totalCents: money.grossCents,
    vatCents: money.vatCents,
  };
}
