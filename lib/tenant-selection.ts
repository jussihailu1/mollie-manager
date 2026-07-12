export const tenantSelectionCookieName = "mollie_manager_tenant";

export type TenantSelectionInput = {
  accessibleTenantIds: string[];
  preferredTenantId?: string | null;
};

export type TenantSelectionCookieOptions = {
  httpOnly: true;
  maxAge: number;
  path: "/";
  sameSite: "lax";
  secure: boolean;
};

export function resolveTenantSelectionId({
  accessibleTenantIds,
  preferredTenantId,
}: TenantSelectionInput) {
  const normalizedPreferredTenantId = preferredTenantId?.trim() || null;

  if (normalizedPreferredTenantId && accessibleTenantIds.includes(normalizedPreferredTenantId)) {
    return normalizedPreferredTenantId;
  }

  return accessibleTenantIds[0] ?? null;
}

export function getTenantSelectionCookieOptions(
  isProduction: boolean,
): TenantSelectionCookieOptions {
  return {
    httpOnly: true,
    maxAge: 31_536_000,
    path: "/",
    sameSite: "lax",
    secure: isProduction,
  };
}
