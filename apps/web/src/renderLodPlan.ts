import type { Lod } from "./lod";

/** Exact counts describe fetched geometry, including the prefetch margin. */
export async function planRenderLod(
  available: readonly Lod[],
  fidelityLod: Lod,
  budget: number,
  fillBudget: boolean,
  estimate: (lod: Lod) => Promise<number>,
  startingLod: Lod = fidelityLod,
) {
  const levels = available.filter(level => fillBudget || level <= fidelityLod);
  if (!levels.length) throw new Error("No available render LOD");
  let index = Math.max(0, levels.indexOf(levels.filter(level => level <= startingLod).at(-1) ?? levels[0]));
  let selected = { lod: levels[index], vertexEstimate: await estimate(levels[index]) };
  while (selected.vertexEstimate > budget && index > 0) {
    index--;
    selected = { lod: levels[index], vertexEstimate: await estimate(levels[index]) };
  }
  while (selected.vertexEstimate <= budget && index + 1 < levels.length) {
    const lod = levels[++index];
    const vertexEstimate = await estimate(lod);
    if (vertexEstimate > budget) break;
    selected = { lod, vertexEstimate };
  }
  return selected;
}
