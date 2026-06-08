import { revalidatePath } from "next/cache";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { requireViewerSession } from "@/lib/auth/session";
import { getSelectedMollieMode } from "@/lib/dashboard-mode";
import {
  repairReliabilityTarget,
} from "@/lib/reliability/repair";

const repairSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(["customer", "payment", "subscription"]),
});

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return error.message.slice(0, 180);
  }

  return "Repair failed.";
}

async function revalidateDashboardPaths() {
  revalidatePath("/");
  revalidatePath("/customers");
  revalidatePath("/notifications");
  revalidatePath("/payments");
  revalidatePath("/settings");
}

export async function POST(request: NextRequest) {
  await requireViewerSession();

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const parsed = repairSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json(
      {
        error: "Provide a repair target id and kind.",
      },
      { status: 400 },
    );
  }

  const selectedMode = await getSelectedMollieMode();

  try {
    const actor = {
      kind: "user" as const,
    };

    const result = await repairReliabilityTarget({
      actor,
      id: parsed.data.id,
      kind: parsed.data.kind,
      mode: selectedMode,
    });

    await revalidateDashboardPaths();

    return Response.json({
      kind: parsed.data.kind,
      result,
      status: result.status,
    });
  } catch (error) {
    return Response.json(
      {
        error: serializeError(error),
      },
      { status: 500 },
    );
  }
}
