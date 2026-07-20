export function formatKifyInvoiceNumber(input: {
  mode: "live" | "test";
  prefix: string;
  sequence: number;
  year: number;
}) {
  if (!/^[A-Z0-9-]+$/.test(input.prefix)) {
    throw new Error("Invoice prefix must be uppercase letters, numbers, or hyphens.");
  }
  if (!Number.isInteger(input.year) || input.year < 2000) {
    throw new Error("Invoice year is invalid.");
  }
  if (!Number.isInteger(input.sequence) || input.sequence < 1) {
    throw new Error("Invoice sequence is invalid.");
  }

  const base = `${input.prefix}-${input.year}-${String(input.sequence).padStart(6, "0")}`;
  return input.mode === "test" ? `TEST-${base}` : base;
}
