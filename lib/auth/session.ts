import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import type { Session } from "next-auth";

import { auth } from "@/auth";
import { setActionFeedbackCookie } from "@/lib/action-feedback-store";
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
  const recipientEmail = session.user.email;

  if (!recipientEmail) {
    redirect("/login");
  }

  if (!hasAdvancedOperationsAccess(session)) {
    await setActionFeedbackCookie({
      expiresAt: Date.now() + 5 * 60 * 1000,
      kind: "error",
      message: "Advanced operations access is required.",
      recipientEmail: recipientEmail.toLowerCase(),
    });
    redirect("/settings");
  }

  return session;
});
