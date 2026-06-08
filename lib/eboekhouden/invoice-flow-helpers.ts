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
  return Number(Number(value).toFixed(2));
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
