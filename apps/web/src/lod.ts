export type Lod = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const LOD_COUNT = 8;
export const MAX_LOD: Lod = 7;
export const RESOLUTION_VERTEX_BUDGETS = {
  low: 750_000,
  medium: 1_250_000,
  high: 1_750_000,
} as const;
export const THREE_D_VERTEX_BUDGETS = {
  low: 100_000,
  medium: 250_000,
  high: 750_000,
} as const;

// Fixed simplification tolerances emitted by the compiler. `null` means full geometry.
export const LOD_TOLERANCES_METERS = [2048, 512, 128, 32, 8, 2, 0.5, null] as const;

const WEB_MERCATOR_RADIUS_METERS = 6_378_137;
const WEB_MERCATOR_CIRCUMFERENCE_METERS = 2 * Math.PI * WEB_MERCATOR_RADIUS_METERS;
const WEB_MERCATOR_WORLD_PIXELS_AT_ZOOM_ZERO = 512;
/** Projected meters represented by one rendered CSS pixel at a Web Mercator zoom. */
export function metersPerPixel(zoom: number): number {
  return WEB_MERCATOR_CIRCUMFERENCE_METERS / (WEB_MERCATOR_WORLD_PIXELS_AT_ZOOM_ZERO * 2 ** zoom);
}

export function lodForMetersPerPixel(pixelMeters: number): Lod {
  for (let lod = 0; lod < LOD_TOLERANCES_METERS.length - 1; lod += 1) {
    const tolerance = LOD_TOLERANCES_METERS[lod];
    if (tolerance != null && tolerance <= pixelMeters) return lod as Lod;
  }
  return MAX_LOD;
}

/**
 * Choose the coarsest fixed-tolerance LOD whose projected simplification error is below
 * one rendered CSS pixel when only camera zoom is available.
 */
export function lodForView(zoom: number): Lod {
  return lodForMetersPerPixel(metersPerPixel(zoom));
}
