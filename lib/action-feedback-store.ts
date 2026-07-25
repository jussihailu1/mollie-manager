import "server-only";

import { cookies } from "next/headers";

import {
  decodeActionFeedback,
  encodeActionFeedback,
  type StoredActionFeedback,
} from "@/lib/action-feedback-codec";
import { env } from "@/lib/env";

export const actionFeedbackCookieName = "kify_action_feedback";
export const actionFeedbackMaxAgeSeconds = 5 * 60;
export const actionFeedbackMaxMessageLength = 180;

export async function setActionFeedbackCookie(input: StoredActionFeedback) {
  const value = encodeActionFeedback(input, env.AUTH_SECRET!);
  const cookieStore = await cookies();

  cookieStore.set(actionFeedbackCookieName, value, {
    httpOnly: true,
    maxAge: actionFeedbackMaxAgeSeconds,
    path: "/",
    sameSite: "lax",
    secure: env.APP_ENV === "production",
  });
}

export async function readActionFeedbackCookie() {
  const cookieStore = await cookies();
  return decodeActionFeedback(
    cookieStore.get(actionFeedbackCookieName)?.value,
    env.AUTH_SECRET!,
    actionFeedbackMaxMessageLength,
  );
}

export async function clearActionFeedbackCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(actionFeedbackCookieName);
}
