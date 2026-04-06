const moneyFormatters = new Map<string, Intl.NumberFormat>();

const dateFormatter = new Intl.DateTimeFormat("nl-NL", {
  dateStyle: "medium",
});

const dateTimeFormatter = new Intl.DateTimeFormat("nl-NL", {
  dateStyle: "medium",
  timeStyle: "short",
});

function parseDate(value: string) {
  return value.length === 10 ? new Date(`${value}T00:00:00Z`) : new Date(value);
}

export function formatCurrency(value: string | number, currency = "EUR") {
  const formatterKey = `${currency}:nl-NL`;
  const formatter =
    moneyFormatters.get(formatterKey) ??
    new Intl.NumberFormat("nl-NL", {
      currency,
      style: "currency",
    });

  moneyFormatters.set(formatterKey, formatter);

  return formatter.format(typeof value === "number" ? value : Number(value));
}

export function formatDate(value: string | null | undefined) {
  if (!value) {
    return "Not available";
  }

  const parsed = parseDate(value);
  return Number.isNaN(parsed.getTime()) ? "Not available" : dateFormatter.format(parsed);
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "Not available";
  }

  const parsed = parseDate(value);
  return Number.isNaN(parsed.getTime())
    ? "Not available"
    : dateTimeFormatter.format(parsed);
}

export function formatLabel(value: string | null | undefined) {
  if (!value) {
    return "Not available";
  }

  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function getSingleSearchParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
