import { type NextRequest } from "next/server";

import {
  getEboekhoudenRelation,
  toPublicEboekhoudenError,
} from "@/lib/eboekhouden/client";
import { relationToLocalFields } from "@/lib/eboekhouden/relation-mapping";
import { getCurrentTenantSelectionForViewer } from "@/lib/tenant-context";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await getCurrentTenantSelectionForViewer();

  const { id } = await params;
  const relationId = Number(id);

  if (!Number.isInteger(relationId) || relationId <= 0) {
    return Response.json(
      { code: "invalid_id", message: "Relation id is invalid." },
      { status: 400 },
    );
  }

  try {
    const relation = await getEboekhoudenRelation(relationId);

    return Response.json({
      localFields: relationToLocalFields(relation),
      relation,
    });
  } catch (error) {
    const publicError = toPublicEboekhoudenError(error);

    return Response.json(publicError, { status: publicError.status });
  }
}
