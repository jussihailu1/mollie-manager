import "server-only";

import { env } from "@/lib/env";

export type AppUserRole = "developer" | "operator";

export function parseEmailAllowlist(value: string | null | undefined) {
  return new Set(
    (value ?? "")
      .split(/[\s,;]+/)
      .map((item) => item.trim().toLowerCase())
      .filter((item) => item.length > 0),
  );
}

export function isAdvancedOperationsEmail(email: string | null | undefined) {
  if (!email) {
    return false;
  }

  return parseEmailAllowlist(env.AUTH_ADVANCED_EMAILS).has(email.toLowerCase());
}

export function roleForEmail(email: string | null | undefined): AppUserRole {
  return isAdvancedOperationsEmail(email) ? "developer" : "operator";
}
