import type { MollieMode } from "@/lib/env";

export async function findMollieResourceAcrossModes<TResource>(
  modes: MollieMode[],
  findResource: (mode: MollieMode) => Promise<TResource>,
  notFoundMessage: string,
) {
  let lastError: unknown;

  for (const mode of modes) {
    try {
      return {
        mode,
        resource: await findResource(mode),
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error(notFoundMessage);
}
