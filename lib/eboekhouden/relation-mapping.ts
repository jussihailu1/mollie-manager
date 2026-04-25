export type EboekhoudenRelation = {
  address?: string | null;
  city?: string | null;
  code?: string | null;
  contact?: string | null;
  country?: string | null;
  emailAddress?: string | null;
  id: number;
  name?: string | null;
  note?: string | null;
  phoneNumber?: string | null;
  postalCode?: string | null;
  type?: "B" | "P" | string | null;
};

export type LocalRelationFields = {
  address: string;
  businessName: string;
  contactName: string;
  email: string;
  notes: string;
  phone: string;
};

export const relationFieldLabels: Record<keyof LocalRelationFields, string> = {
  address: "Address",
  businessName: "Business name",
  contactName: "Contact name",
  email: "Email",
  notes: "Notes",
  phone: "Phone",
};

export const relationFieldNames = Object.keys(
  relationFieldLabels,
) as (keyof LocalRelationFields)[];

export function cleanRelationValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function composeRelationAddress(relation: EboekhoudenRelation) {
  return [
    cleanRelationValue(relation.address),
    [cleanRelationValue(relation.postalCode), cleanRelationValue(relation.city)]
      .filter(Boolean)
      .join(" "),
    cleanRelationValue(relation.country),
  ]
    .filter(Boolean)
    .join(", ");
}

export function relationToLocalFields(
  relation: EboekhoudenRelation,
): LocalRelationFields {
  return {
    address: composeRelationAddress(relation),
    businessName: cleanRelationValue(relation.name),
    contactName: cleanRelationValue(relation.contact),
    email: cleanRelationValue(relation.emailAddress),
    notes: cleanRelationValue(relation.note),
    phone: cleanRelationValue(relation.phoneNumber),
  };
}

export function normalizeComparable(value: string | null | undefined) {
  return cleanRelationValue(value).replace(/\s+/g, " ").toLowerCase();
}

export function hasMeaningfulDifference(
  left: string | null | undefined,
  right: string | null | undefined,
) {
  return normalizeComparable(left) !== normalizeComparable(right);
}

export function localFieldsToRelationPatch(
  fields: Partial<LocalRelationFields>,
  currentRelation: EboekhoudenRelation,
) {
  const patch: Record<string, string> = {};
  const businessName = cleanRelationValue(fields.businessName);

  patch.name = businessName || cleanRelationValue(currentRelation.name);

  const mappings = [
    ["contactName", "contact"],
    ["email", "emailAddress"],
    ["phone", "phoneNumber"],
    ["notes", "note"],
    ["address", "address"],
  ] as const;

  for (const [localField, relationField] of mappings) {
    const value = cleanRelationValue(fields[localField]);

    if (value.length > 0) {
      patch[relationField] = value;
    }
  }

  return patch;
}
