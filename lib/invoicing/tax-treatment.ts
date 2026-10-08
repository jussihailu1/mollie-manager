export type TaxTreatment = "kor" | "standard";

export const KOR_INVOICE_NOTICE =
  "Factuur vrijgesteld van omzetbelasting op grond van de kleineondernemersregeling (KOR).";

export function requireTaxTreatment(value: TaxTreatment | null | undefined): TaxTreatment {
  if (value !== "kor" && value !== "standard") {
    throw new Error("Select whether this organization participates in the KOR before issuing invoices.");
  }
  return value;
}

export function eboekhoudenTaxFields(treatment: TaxTreatment) {
  return treatment === "kor"
    ? { inExVat: "IN" as const, vatCode: "GEEN", text: KOR_INVOICE_NOTICE }
    : { inExVat: "IN" as const, vatCode: "HOOG_VERK_21", text: undefined };
}

export function eboekhoudenInvoiceDescription(description: string, treatment: TaxTreatment) {
  return treatment === "kor" ? `${description} — ${KOR_INVOICE_NOTICE}` : description;
}
