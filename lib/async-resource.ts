export type AsyncResourceSnapshot<T> = {
  data: T | null;
  error: string | null;
  loading: boolean;
};

// Each resource owns one request identity. Replaced resources cannot publish into
// their successor, and cleanup invalidates results even if a loader ignores abort.
export function createAsyncResource<T>(
  load: ((signal: AbortSignal) => Promise<T>) | null,
) {
  let snapshot: AsyncResourceSnapshot<T> = { data: null, error: null, loading: !!load };
  const initialSnapshot = snapshot;
  const listeners = new Set<() => void>();
  let generation = 0;
  function publish(next: AsyncResourceSnapshot<T>) {
    snapshot = next;
    listeners.forEach((listener) => listener());
  }
  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => initialSnapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    start() {
      if (!load) return;
      const request = ++generation;
      const controller = new AbortController();
      publish({ data: null, error: null, loading: true });
      load(controller.signal).then(
        (data) => {
          if (request === generation) publish({ data, error: null, loading: false });
        },
        (error: unknown) => {
          if (request === generation) publish({
            data: null,
            error: error instanceof Error ? error.message : "Request failed.",
            loading: false,
          });
        },
      );
      return () => {
        ++generation;
        controller.abort();
      };
    },
  };
}
