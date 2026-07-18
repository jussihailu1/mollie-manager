export const ROUTE_REFRESH_FAST_MS = 30_000;
export const ROUTE_REFRESH_MEDIUM_MS = 90_000;
export const REPAIR_STALE_AFTER_MS = 10 * 60_000;
export const REPAIR_RETRY_AFTER_MS = 5 * 60_000;

export function getRouteRefreshIntervalMs(pathname: string) {
  switch (pathname) {
    case "/":
    case "/notifications":
    case "/settings":
      return ROUTE_REFRESH_FAST_MS;
    case "/customers":
    case "/payments":
      return ROUTE_REFRESH_MEDIUM_MS;
    default:
      return null;
  }
}

export function isOlderThan(
  value: string | null | undefined,
  thresholdMs: number,
  now = Date.now(),
) {
  if (!value) {
    return true;
  }

  const parsed = Date.parse(value);

  if (Number.isNaN(parsed)) {
    return true;
  }

  return now - parsed >= thresholdMs;
}
