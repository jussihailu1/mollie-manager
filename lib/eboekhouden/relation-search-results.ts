import {
  relationToLocalFields,
  type EboekhoudenRelation,
  type LocalRelationFields,
} from "@/lib/eboekhouden/relation-mapping";

export type EboekhoudenRelationSearchResultItem = {
  code: string;
  id: number;
  localFields: LocalRelationFields | null;
  name: string;
  type: string;
};

function hasAnyLocalField(fields: LocalRelationFields) {
  return Object.values(fields).some((value) => value.length > 0);
}

export function toRelationSearchResultItems(
  items: readonly EboekhoudenRelation[],
  linkedRelationIds: ReadonlySet<number>,
): EboekhoudenRelationSearchResultItem[] {
  return items
    .filter((item) => !linkedRelationIds.has(item.id))
    .map((item) => {
      const localFields = relationToLocalFields(item);

      return {
        code: item.code ?? "",
        id: item.id,
        localFields: hasAnyLocalField(localFields) ? localFields : null,
        name: item.name ?? "",
        type: item.type ?? "B",
      };
    });
}
