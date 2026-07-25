export type DashboardDrawerResource = "customers" | "payments";

function toSearchParams(search?: string | URLSearchParams) {
  const value = search?.toString() ?? "";
  const query = value.includes("?")
    ? value.split("?", 2)[1] ?? ""
    : value.startsWith("/")
      ? ""
      : value;
  const params = new URLSearchParams(query);
  params.delete("focus");
  return params;
}

export function buildDrawerCollectionPath(
  resource: DashboardDrawerResource,
  search?: string | URLSearchParams,
) {
  const params = toSearchParams(search);
  const query = params.toString();

  return query ? `/${resource}?${query}` : `/${resource}`;
}

export function buildDrawerPath(
  resource: DashboardDrawerResource,
  id: string,
  search?: string | URLSearchParams,
) {
  const params = toSearchParams(search);
  const query = params.toString();
  const pathname = `/${resource}/${encodeURIComponent(id)}`;

  return query ? `${pathname}?${query}` : pathname;
}

export function getDrawerIdFromPath(
  resource: DashboardDrawerResource,
  pathname: string,
) {
  const prefix = `/${resource}/`;

  if (!pathname.startsWith(prefix)) {
    return null;
  }

  const encodedId = pathname.slice(prefix.length);

  if (!encodedId || encodedId.includes("/")) {
    return null;
  }

  try {
    return decodeURIComponent(encodedId);
  } catch {
    return null;
  }
}
