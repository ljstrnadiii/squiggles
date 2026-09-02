export type Lod = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const LOD_COUNT = 8;
export const MAX_LOD: Lod = 7;
export const RESOLUTION_VERTEX_BUDGETS = { low: 250_000, medium: 750_000, high: 1_250_000 } as const;

const MEDIUM_ZOOM_BREAKS = [7, 9, 11, 13, 15, 17, 19] as const;

export function lodForZoom(zoom: number, resolution: "low" | "medium" | "high" = "medium"): Lod {
  let medium = 0;
  while (medium < MEDIUM_ZOOM_BREAKS.length && zoom >= MEDIUM_ZOOM_BREAKS[medium]) medium += 1;
  const shift = resolution === "low" ? -1 : resolution === "high" ? 1 : 0;
  return Math.max(0, Math.min(MAX_LOD, medium + shift)) as Lod;
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
