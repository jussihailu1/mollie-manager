"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { createAsyncResource } from "@/lib/async-resource";

export function useAsyncResource<T>(load: ((signal: AbortSignal) => Promise<T>) | null) {
  const resource = useMemo(() => createAsyncResource(load), [load]);
  const snapshot = useSyncExternalStore(
    resource.subscribe, resource.getSnapshot, resource.getServerSnapshot,
  );
  useEffect(() => resource.start(), [resource]);
  return snapshot;
}

export function useJsonResource<T>(url: string | null, fallback: string, revision: unknown = 0) {
  const load = useCallback(async (signal: AbortSignal): Promise<T> => {
    // Revision deliberately participates in request identity without changing the URL.
    void revision;
    const response = await fetch(url!, { cache: "no-store", signal });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload === null) {
      throw new Error(typeof payload?.error === "string" ? payload.error : fallback);
    }
    return payload as T;
  }, [url, fallback, revision]);
  return useAsyncResource(url ? load : null);
}
