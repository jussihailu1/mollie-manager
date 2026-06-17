import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import type { Session } from "next-auth";

import { auth } from "@/auth";
import { env, isTestAuthBypassEnabled } from "@/lib/env";

function getTestViewerSession() {
  return {
    expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    user: {
      email: env.AUTH_TEST_USER_EMAIL,
      id: "codex-test-owner",
      image: null,
      name: env.AUTH_TEST_USER_NAME,
      role: "developer",
    },
  } satisfies Session;
}

export const getViewerSession = cache(async () => {
  if (isTestAuthBypassEnabled()) {
    return getTestViewerSession();
  }

  return auth();
});

export const requireViewerSession = cache(async () => {
  const session = await getViewerSession();

  if (!session?.user?.email) {
    redirect("/login");
  }

  return session;
});

export function hasAdvancedOperationsAccess(
  session: Pick<Session, "user"> | null | undefined,
) {
  return session?.user?.role === "developer";
}

export const requireAdvancedOperationsSession = cache(async () => {
  const session = await requireViewerSession();

  if (!hasAdvancedOperationsAccess(session)) {
    redirect("/settings?error=Advanced%20operations%20access%20is%20required.");
  }

  return session;
});
