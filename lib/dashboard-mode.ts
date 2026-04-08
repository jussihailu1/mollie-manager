import "server-only";

import { cookies } from "next/headers";

import { env, type MollieMode } from "@/lib/env";

export type DashboardModeFilter = "all" | MollieMode;

export const dashboardModeCookieName = "mollie_manager_mode";

function isMollieMode(value: string | null | undefined): value is MollieMode {
  return value === "test" || value === "live";
}

export async function getSelectedMollieMode(): Promise<MollieMode> {
  const cookieStore = await cookies();
  const selectedMode = cookieStore.get(dashboardModeCookieName)?.value;

  return isMollieMode(selectedMode) ? selectedMode : env.MOLLIE_DEFAULT_MODE;
}

export async function resolveDashboardModeFilter(
  searchParam: string | null | undefined,
): Promise<DashboardModeFilter> {
  if (searchParam === "all") {
    return "all";
  }

  if (isMollieMode(searchParam)) {
    return searchParam;
  }

  return getSelectedMollieMode();
}
