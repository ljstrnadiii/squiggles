export type Lod = 0 | 1 | 2 | 3 | 4;

export const LOD_VERTEX_LIMITS = [40, 100, 400, 2000] as const;
export const RESOLUTION_VERTEX_BUDGETS = { low: 250_000, medium: 750_000, high: 1_250_000 } as const;

export function chooseLod(estimates: readonly number[], zoomLod: Lod, budget: number): Lod {
  // Zoom is a fidelity ceiling as well as an interaction budget. This keeps
  // broad views on deliberately coarse overviews instead of promoting them
  // merely because a more detailed representation happens to fit in memory.
  let planned: Lod = zoomLod;
  while (planned > 0 && estimates[planned] > budget) planned = (planned - 1) as Lod;
  return planned;
}
