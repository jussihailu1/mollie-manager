import { sql } from "drizzle-orm";
import { type NextRequest } from "next/server";

import {
  getEboekhoudenRelation,
  searchEboekhoudenRelations,
  toPublicEboekhoudenError,
} from "@/lib/eboekhouden/client";
import { relationToLocalFields } from "@/lib/eboekhouden/relation-mapping";
import { requireViewerSession } from "@/lib/auth/session";
import { getSelectedMollieMode } from "@/lib/dashboard-mode";
import { getDb } from "@/lib/db";

async function getLinkedRelationIds() {
  const selectedMode = await getSelectedMollieMode();
  const result = await getDb().execute<{ relationId: number }>(sql`
      select eboekhouden_relation_id as "relationId"
      from customers
      where mode = ${selectedMode}
        and eboekhouden_relation_id is not null
    `);

  return new Set(result.rows.map((row) => row.relationId));
}

export async function GET(request: NextRequest) {
  await requireViewerSession();

  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get("q")?.trim() ?? "";
  const limit = Number(searchParams.get("limit") ?? "20");
  const offset = Number(searchParams.get("offset") ?? "0");
  const excludeLinked = searchParams.get("excludeLinked") !== "false";

  try {
    const [relationsList, linkedRelationIds] = await Promise.all([
      searchEboekhoudenRelations({
        limit: Number.isFinite(limit) ? limit : 20,
        offset: Number.isFinite(offset) ? offset : 0,
        query,
      }),
      excludeLinked ? getLinkedRelationIds() : Promise.resolve(new Set<number>()),
    ]);
    const unlinkedItems = (relationsList.items ?? []).filter(
      (item) => !linkedRelationIds.has(item.id),
    );
    const hydratedItems = await Promise.all(
      unlinkedItems.map(async (item) => {
        try {
          const relation = await getEboekhoudenRelation(item.id);
          return {
            code: relation.code ?? item.code ?? "",
            id: item.id,
            localFields: relationToLocalFields(relation),
            name: relation.name ?? "",
            type: relation.type ?? item.type ?? "B",
          };
        } catch {
          return {
            code: item.code ?? "",
            id: item.id,
            localFields: null,
            name: "",
            type: item.type ?? "B",
          };
        }
      }),
    );

    return Response.json({
      count: relationsList.count ?? hydratedItems.length,
      items: hydratedItems,
    });
  } catch (error) {
    const publicError = toPublicEboekhoudenError(error);

    return Response.json(publicError, { status: publicError.status });
  }
}
