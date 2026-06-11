export type ReconciliationMode = "full" | "sync_only";

export function shouldRunBillingFollowups(mode: ReconciliationMode) {
  return mode === "full";
}

export function formatReconciliationMode(mode: ReconciliationMode) {
  return mode === "sync_only" ? "Sync-only" : "Full";
}
