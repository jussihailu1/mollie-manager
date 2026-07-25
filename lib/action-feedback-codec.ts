import { createHmac, timingSafeEqual } from "node:crypto";

import type { ActionFeedback, ActionFeedbackKind } from "@/lib/action-feedback-types";

export type StoredActionFeedback = ActionFeedback & {
  expiresAt: number;
  recipientEmail: string;
};

function isFeedbackKind(value: unknown): value is ActionFeedbackKind {
  return value === "success" || value === "error" || value === "information";
}

function signPayload(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function encodeActionFeedback(input: StoredActionFeedback, secret: string) {
  const payload = Buffer.from(JSON.stringify(input)).toString("base64url");
  return `${payload}.${signPayload(payload, secret)}`;
}

export function decodeActionFeedback(
  value: string | undefined,
  secret: string,
  maxMessageLength: number,
): StoredActionFeedback | null {
  if (!value) {
    return null;
  }

  const [encodedPayload, signature, ...rest] = value.split(".");

  if (!encodedPayload || !signature || rest.length > 0) {
    return null;
  }

  const expectedSignature = signPayload(encodedPayload, secret);
  const signatureBuffer = Buffer.from(signature);
  const expectedSignatureBuffer = Buffer.from(expectedSignature);

  if (
    signatureBuffer.length !== expectedSignatureBuffer.length ||
    !timingSafeEqual(signatureBuffer, expectedSignatureBuffer)
  ) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as Partial<StoredActionFeedback>;

    if (
      !isFeedbackKind(parsed.kind) ||
      typeof parsed.message !== "string" ||
      parsed.message.length === 0 ||
      parsed.message.length > maxMessageLength ||
      typeof parsed.recipientEmail !== "string" ||
      typeof parsed.expiresAt !== "number" ||
      !Number.isFinite(parsed.expiresAt)
    ) {
      return null;
    }

    return {
      kind: parsed.kind,
      message: parsed.message,
      recipientEmail: parsed.recipientEmail,
      expiresAt: parsed.expiresAt,
    };
  } catch {
    return null;
  }
}
