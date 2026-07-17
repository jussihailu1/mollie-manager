"use server";

import { redirect } from "next/navigation";

import { disconnectTenantMollieConnection, listTenantMollieProfiles, selectTenantMollieProfile } from "@/lib/mollie/tenant-connections";
import { getCurrentTenantSelectionForViewer } from "@/lib/tenant-context";

export async function selectMollieProfileAction(formData: FormData) {
  const { currentTenant } = await getCurrentTenantSelectionForViewer();
  const profileId = String(formData.get("profileId") ?? "").trim();
  const profile = (await listTenantMollieProfiles(currentTenant.id)).find((entry) => entry.id === profileId);
  if (!profile) throw new Error("The selected Mollie profile is not available to this tenant.");
  await selectTenantMollieProfile({ tenantId: currentTenant.id, profileId, profileName: profile.name });
  redirect("/settings?notice=Mollie%20profile%20selected.");
}

export async function disconnectMollieConnectionAction() {
  const { currentTenant } = await getCurrentTenantSelectionForViewer();
  await disconnectTenantMollieConnection(currentTenant.id);
  redirect("/settings?notice=Mollie%20connection%20disconnected.");
}
