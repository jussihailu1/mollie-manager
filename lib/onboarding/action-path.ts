export function buildActionPath(pathname: string, params?: URLSearchParams) {
  const search = params?.toString();
  return search ? `${pathname}?${search}` : pathname;
}

export function updateActionPath(
  pathname: string,
  updates: Record<string, string | null | undefined>,
) {
  const [basePath, existingSearch] = pathname.split("?", 2);
  const params = new URLSearchParams(existingSearch ?? "");

  for (const [key, value] of Object.entries(updates)) {
    if (value === null || value === undefined || value.length === 0) {
      params.delete(key);
      continue;
    }

    params.set(key, value);
  }

  return buildActionPath(basePath, params);
}
