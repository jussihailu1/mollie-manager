import { redirectWithActionFeedback } from "@/lib/action-feedback";

export async function redirectWithMessage(
  pathname: string,
  options: { error?: string; notice?: string },
): Promise<never> {
  return redirectWithActionFeedback(
    pathname,
    options.error
      ? { kind: "error", message: options.error }
      : options.notice
        ? { kind: "success", message: options.notice }
        : undefined,
  );
}

export function serializeError(error: unknown) {
  if (error instanceof Error) {
    return error.message.slice(0, 180);
  }

  return "Something went wrong while talking to Mollie.";
}
