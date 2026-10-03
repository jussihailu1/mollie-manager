export async function recoverTargetsIndependently<T>(
  targets: T[],
  repair: (target: T) => Promise<"repaired" | "skipped">,
  onFailure: (target: T) => Promise<void>,
) {
  let repairedCount = 0;
  let skippedCount = 0;
  for (const target of targets) {
    try {
      if (await repair(target) === "repaired") repairedCount++;
      else skippedCount++;
    } catch {
      skippedCount++;
      await onFailure(target);
    }
  }
  return { repairedCount, skippedCount };
}
