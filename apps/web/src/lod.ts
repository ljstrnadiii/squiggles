export type Lod = 0 | 1 | 2 | 3 | 4;

export const LOD_VERTEX_LIMITS = [40, 100, 400, 2000] as const;
export const LOD_VIEWPORT_BUDGETS = [750000, 900000, 1200000, 1500000, 2000000] as const;

export function vertexBudget(zoomLod: Lod): number {
  return LOD_VIEWPORT_BUDGETS[zoomLod];
}

export function chooseLod(estimates: readonly number[], zoomLod: Lod): Lod {
  // Zoom is a fidelity ceiling, not permission for an unbounded raw-column
  // read. Raw geometry returns automatically once the visible extent is small
  // enough; dense close views retain the highest compiled LOD within budget.
  let planned: Lod = zoomLod === 4 ? 4 : 3;
  while (planned > 0 && estimates[planned] > vertexBudget(zoomLod)) planned = (planned - 1) as Lod;
  return planned;
}
