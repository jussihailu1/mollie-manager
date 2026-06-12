import { redirect } from "next/navigation";

export function buildPath(pathname: string, params?: URLSearchParams) {
  const search = params?.toString();
  return search ? `${pathname}?${search}` : pathname;
}

export function redirectWithMessage(
  pathname: string,
  options: { error?: string; notice?: string },
): never {
  const params = new URLSearchParams();

  if (options.notice) {
    params.set("notice", options.notice);
  }

  if (options.error) {
    params.set("error", options.error);
  }

  redirect(buildPath(pathname, params));
}

export function serializeError(error: unknown) {
  if (error instanceof Error) {
    return error.message.slice(0, 180);
  }

  return "Something went wrong while talking to Mollie.";
}
