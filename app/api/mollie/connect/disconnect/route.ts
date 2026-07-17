import { NextResponse } from "next/server";

import { writeAuditLog } from "@/lib/audit";
import { disconnectTenantMollieConnection } from "@/lib/mollie/tenant-connections";
import { getCurrentTenantSelectionForViewer } from "@/lib/tenant-context";

export async function POST() {
  const { currentTenant, session } = await getCurrentTenantSelectionForViewer();
  await disconnectTenantMollieConnection(currentTenant.id);
  await writeAuditLog({ action: "mollie.connect.disconnected", entityType: "tenant_mollie_connection", entityId: currentTenant.id, outcome: "success", summary: "Mollie connection disconnected." }, undefined, { kind: "user", email: session.user.email });
  return NextResponse.json({ ok: true });
}
