import type { Lod } from "./lod";

export const ACTIVITY_SAMPLE_LOD_BOOST = 2;

export function boostedSampleLod(
  available: readonly Lod[],
  budgetLod: Lod,
  fidelityLod: Lod,
  steps = ACTIVITY_SAMPLE_LOD_BOOST,
): Lod {
  let result = budgetLod;
  for (let step = 0; step < steps; step += 1) {
    const next = available.find((level) => level > result && level <= fidelityLod);
    if (next == null) break;
    result = next;
  }
  return result;
}
