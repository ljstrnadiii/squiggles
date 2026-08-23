export type Lod = 0 | 1 | 2 | 3 | 4;

export const LOD_VERTEX_LIMITS = [40, 100, 400, 2000] as const;
export const LOD_VIEWPORT_BUDGETS = [250000, 400000, 600000, 850000, 1000000] as const;

export function vertexBudget(zoomLod: Lod): number {
  return LOD_VIEWPORT_BUDGETS[zoomLod];
}

export function chooseLod(estimates: readonly number[], zoomLod: Lod): Lod {
  // Zoom is a fidelity ceiling as well as an interaction budget. This keeps
  // broad views on deliberately coarse overviews instead of promoting them
  // merely because a more detailed representation happens to fit in memory.
  let planned: Lod = zoomLod;
  while (planned > 0 && estimates[planned] > vertexBudget(zoomLod)) planned = (planned - 1) as Lod;
  return planned;
}
