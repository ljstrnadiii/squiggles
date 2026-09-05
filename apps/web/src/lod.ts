export type Lod = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const LOD_COUNT = 8;
export const MAX_LOD: Lod = 7;
export const RESOLUTION_VERTEX_BUDGETS = {
  low: 750_000,
  medium: 1_250_000,
  high: 1_750_000,
} as const;

// Fixed simplification tolerances emitted by the compiler. `null` means full geometry.
export const LOD_TOLERANCES_METERS = [2048, 512, 128, 32, 8, 2, 0.5, null] as const;

const WEB_MERCATOR_CIRCUMFERENCE_METERS = 2 * Math.PI * 6_378_137;
const WEB_MERCATOR_WORLD_PIXELS_AT_ZOOM_ZERO = 512;

/** Ground distance represented by one rendered CSS pixel at the camera center. */
export function metersPerPixel(zoom: number, latitude: number): number {
  const clampedLatitude = Math.max(-85.05112878, Math.min(85.05112878, latitude));
  return (
    (WEB_MERCATOR_CIRCUMFERENCE_METERS * Math.cos((clampedLatitude * Math.PI) / 180)) /
    (WEB_MERCATOR_WORLD_PIXELS_AT_ZOOM_ZERO * 2 ** zoom)
  );
}

/**
 * Choose the coarsest fixed-tolerance LOD whose simplification error is below one
 * rendered CSS pixel. Basemap source GSD is intentionally not part of this test:
 * route error visibility is a screen-space property of the map projection.
 */
export function lodForView(zoom: number, latitude: number): Lod {
  const pixelMeters = metersPerPixel(zoom, latitude);
  for (let lod = 0; lod < LOD_TOLERANCES_METERS.length - 1; lod += 1) {
    const tolerance = LOD_TOLERANCES_METERS[lod];
    if (tolerance != null && tolerance <= pixelMeters) return lod as Lod;
  }
  return MAX_LOD;
}

export function chooseLod(estimates: readonly number[], fidelityLod: Lod, budget: number): Lod {
  let planned: Lod = fidelityLod;
  while (planned > 0 && (estimates[planned] ?? Number.POSITIVE_INFINITY) > budget) {
    planned = (planned - 1) as Lod;
  }
  return planned;
}
