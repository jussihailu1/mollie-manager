import type { MollieMode } from "@/lib/env";

export type MollieModeAvailability = (mode: MollieMode) => boolean;

export function buildConfiguredMollieModeOrder(input: {
  isConfigured: MollieModeAvailability;
  preferredMode?: MollieMode;
  strictMode?: boolean;
}) {
  const { isConfigured, preferredMode, strictMode = false } = input;

  if (preferredMode && strictMode) {
    return isConfigured(preferredMode) ? [preferredMode] : [];
  }

  const orderedModes: MollieMode[] = preferredMode
    ? [preferredMode, preferredMode === "live" ? "test" : "live"]
    : ["live", "test"];

  return orderedModes.filter(
    (mode, index, array): mode is MollieMode =>
      array.indexOf(mode) === index && isConfigured(mode),
  );
}
