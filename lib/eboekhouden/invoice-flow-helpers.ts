export function toInvoiceCount(value: unknown) {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    return Number(value);
  }

  return 0;
}

export function toInvoiceAmountNumber(value: string) {
  const match = /^(0|[1-9]\d*)\.(\d{2})$/.exec(value);
  const cents = match ? Number(match[1]) * 100 + Number(match[2]) : NaN;
  if (!Number.isSafeInteger(cents) || cents <= 0) {
    throw new Error("Invoice amount must be a positive EUR amount with exactly two decimal places before e-Boekhouden creation.");
  }
  return Number(value);
}

export function serializeInvoiceErrorMessage(
  error: unknown,
  fallbackMessage: string,
) {
  if (error instanceof Error) {
    return error.message.slice(0, 500);
  }

  return fallbackMessage;
}

export function toInvoiceDateString(value: string | null) {
  if (!value) {
    return null;
  }

  return value.slice(0, 10);
}

export function isEboekhoudenReferenceAlreadyExistsError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.includes("FACT_VERWERK_004") ||
    error.message.includes("already exists") ||
    error.message.includes("FACT_014")
  );
}
