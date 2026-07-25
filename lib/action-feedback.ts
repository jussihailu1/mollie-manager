"use server";

import "server-only";

import { redirect } from "next/navigation";

import {
  actionFeedbackMaxAgeSeconds,
  actionFeedbackMaxMessageLength,
  clearActionFeedbackCookie,
  readActionFeedbackCookie,
  setActionFeedbackCookie,
} from "@/lib/action-feedback-store";
import type { ActionFeedback } from "@/lib/action-feedback-types";
import { requireViewerSession } from "@/lib/auth/session";

function withoutLegacyFeedbackParams(pathname: string) {
  const [basePath, search] = pathname.split("?", 2);
  const params = new URLSearchParams(search ?? "");
  params.delete("notice");
  params.delete("error");
  const remainingSearch = params.toString();

  return remainingSearch ? `${basePath}?${remainingSearch}` : basePath;
}

export async function redirectWithActionFeedback(
  pathname: string,
  feedback?: ActionFeedback,
): Promise<never> {
  if (feedback) {
    const session = await requireViewerSession();
    const recipientEmail = session.user.email!.toLowerCase();
    await setActionFeedbackCookie({
      ...feedback,
      message: feedback.message.slice(0, actionFeedbackMaxMessageLength),
      recipientEmail,
      expiresAt: Date.now() + actionFeedbackMaxAgeSeconds * 1000,
    });
  }

  redirect(withoutLegacyFeedbackParams(pathname));
}

export async function hasPendingActionFeedback() {
  return Boolean(await readActionFeedbackCookie());
}

export async function consumeActionFeedbackAction(): Promise<ActionFeedback | null> {
  const session = await requireViewerSession();
  const storedFeedback = await readActionFeedbackCookie();
  await clearActionFeedbackCookie();

  if (
    !storedFeedback ||
    storedFeedback.expiresAt < Date.now() ||
    storedFeedback.recipientEmail !== session.user.email!.toLowerCase()
  ) {
    return null;
  }

  return {
    kind: storedFeedback.kind,
    message: storedFeedback.message,
  };
}
