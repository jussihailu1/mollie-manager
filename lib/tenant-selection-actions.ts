"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireViewerSession } from "@/lib/auth/session";
import {
  getTenantSelectionCookieOptions,
  resolveTenantSelectionId,
  tenantSelectionCookieName,
} from "@/lib/tenant-selection";
import { getAccessibleTenantsForOperatorEmail } from "@/lib/tenants";

const setSelectedTenantSchema = z.object({
  returnTo: z.string().trim().startsWith("/").default("/"),
  tenantId: z.string().trim().min(1),
});

export async function setSelectedTenantAction(formData: FormData) {
  const parsed = setSelectedTenantSchema.safeParse({
    returnTo: formData.get("returnTo") || "/",
    tenantId: formData.get("tenantId"),
  });

  if (!parsed.success) {
    redirect("/");
  }

  const session = await requireViewerSession();
  const accessibleTenants = await getAccessibleTenantsForOperatorEmail(session.user.email);
  const selectedTenantId = resolveTenantSelectionId({
    accessibleTenantIds: accessibleTenants.map((tenant) => tenant.id),
    preferredTenantId: parsed.data.tenantId,
  });

  if (!selectedTenantId) {
    throw new Error("Tenant membership is required for operator access.");
  }

  const cookieStore = await cookies();

  cookieStore.set(
    tenantSelectionCookieName,
    selectedTenantId,
    getTenantSelectionCookieOptions(process.env.NODE_ENV === "production"),
  );

  revalidatePath(parsed.data.returnTo);
  redirect(parsed.data.returnTo);
}
