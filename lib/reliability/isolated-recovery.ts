export async function recoverTargetsIndependently<T>(
  targets: T[],
  repair: (target: T) => Promise<"repaired" | "skipped">,
  onFailure: (target: T) => Promise<void>,
) {
  let repairedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  for (const target of targets) {
    try {
      if (await repair(target) === "repaired") repairedCount++;
      else skippedCount++;
    } catch {
      failedCount++;
      // Keep failures in skippedCount for existing consumers; expose them separately too.
      skippedCount++;
      try { await onFailure(target); } catch {
        console.error("Kify recovery failure audit unavailable; continuing remaining targets.");
      }
    }
  }
  return { repairedCount, skippedCount, failedCount };
}
