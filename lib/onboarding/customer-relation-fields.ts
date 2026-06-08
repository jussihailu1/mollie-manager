import {
  relationToLocalFields,
  type EboekhoudenRelation,
  type LocalRelationFields,
} from "@/lib/eboekhouden/relation-mapping";

export type CustomerRelationFieldInput = {
  address?: string;
  businessName: string;
  contactName: string;
  email: string;
  notes?: string;
  phone?: string;
};

export function toCustomerRelationFields(
  data: CustomerRelationFieldInput,
): LocalRelationFields {
  return {
    address: data.address ?? "",
    businessName: data.businessName,
    contactName: data.contactName,
    email: data.email,
    notes: data.notes ?? "",
    phone: data.phone ?? "",
  };
}

export function shouldPatchEboekhoudenRelation(
  relation: EboekhoudenRelation,
  fields: LocalRelationFields,
) {
  const existingFields = relationToLocalFields(relation);

  return Object.entries(fields).some(([field, value]) => {
    const currentValue = existingFields[field as keyof LocalRelationFields];
    return value.trim().length > 0 && currentValue.trim() !== value.trim();
  });
}
