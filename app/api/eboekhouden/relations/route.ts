import { sql } from "drizzle-orm";
import { type NextRequest } from "next/server";

import {
  searchEboekhoudenRelations,
  toPublicEboekhoudenError,
} from "@/lib/eboekhouden/client";
import { toRelationSearchResultItems } from "@/lib/eboekhouden/relation-search-results";
import { getSelectedMollieMode } from "@/lib/dashboard-mode";
import { getDb } from "@/lib/db";
import { getCurrentTenantSelectionForViewer } from "@/lib/tenant-context";

async function getLinkedRelationIds(tenantId: string) {
  const selectedMode = await getSelectedMollieMode();
  const result = await getDb().execute<{ relationId: number }>(sql`
      select eboekhouden_relation_id as "relationId"
      from customers
      where tenant_id = ${tenantId}
        and mode = ${selectedMode}
        and eboekhouden_relation_id is not null
    `);

  return new Set(result.rows.map((row) => row.relationId));
}

export async function GET(request: NextRequest) {
  const { currentTenant } = await getCurrentTenantSelectionForViewer();

  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get("q")?.trim() ?? "";
  const limit = Number(searchParams.get("limit") ?? "20");
  const offset = Number(searchParams.get("offset") ?? "0");
  const excludeLinked = searchParams.get("excludeLinked") !== "false";

  try {
    const [relationsList, linkedRelationIds] = await Promise.all([
      searchEboekhoudenRelations({
        tenantId: currentTenant.id,
        limit: Number.isFinite(limit) ? limit : 20,
        offset: Number.isFinite(offset) ? offset : 0,
        query,
      }),
      excludeLinked
        ? getLinkedRelationIds(currentTenant.id)
        : Promise.resolve(new Set<number>()),
    ]);
    const items = toRelationSearchResultItems(
      relationsList.items ?? [],
      linkedRelationIds,
    );

    return Response.json({
      count: relationsList.count ?? items.length,
      items,
    });
  } catch (error) {
    const publicError = toPublicEboekhoudenError(error);

    return Response.json(publicError, { status: publicError.status });
  }
}
