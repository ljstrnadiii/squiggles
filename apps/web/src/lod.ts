export type Lod = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const LOD_COUNT = 8;
export const MAX_LOD: Lod = 7;
export const RESOLUTION_VERTEX_BUDGETS = { low: 750_000, medium: 1_250_000, high: 1_750_000 } as const;

const BASE_ZOOM_BREAKS = [7, 9, 11, 13, 15, 17, 19] as const;

export function lodForZoom(zoom: number, resolution: "low" | "medium" | "high" = "medium"): Lod {
  let base = 0;
  while (base < BASE_ZOOM_BREAKS.length && zoom >= BASE_ZOOM_BREAKS[base]) base += 1;
  const shift = resolution === "low" ? 0 : resolution === "medium" ? 1 : 2;
  return Math.max(0, Math.min(MAX_LOD, base + shift)) as Lod;
}

export function chooseLod(estimates: readonly number[], zoomLod: Lod, budget: number): Lod {
  // Zoom/resolution define the fidelity ceiling. The vertex budget may only
  // move toward coarser render levels when the requested level is too large.
  let planned: Lod = zoomLod;
  while (planned > 0 && (estimates[planned] ?? Number.POSITIVE_INFINITY) > budget) {
    planned = (planned - 1) as Lod;
  }
  return planned;
}
