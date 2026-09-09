import type { SystemResolution } from "./contracts";

export type Lod = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const LOD_COUNT = 8;
export const MAX_LOD: Lod = 7;
export const RESOLUTION_VERTEX_BUDGETS = {
  low: 500_000,
  medium: 750_000,
  high: 1_000_000,
} as const;
export const THREE_D_VERTEX_BUDGETS = {
  low: 325_000,
  medium: 500_000,
  high: 650_000,
} as const;
export const MIN_VERTEX_BUDGETS = {
  low: 100_000,
  medium: 200_000,
  high: 300_000,
} as const;
export const MIN_THREE_D_VERTEX_BUDGETS = {
  low: 75_000,
  medium: 125_000,
  high: 200_000,
} as const;

const BUDGET_ZOOM_MIN = 7;
const BUDGET_ZOOM_MAX = 13;
const BUDGET_QUANTUM = 50_000;

function smoothstep(value: number) {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

export function scheduledVertexBudget(
  resolution: SystemResolution,
  zoom: number,
  threeD = false,
): number {
  const minimums = threeD ? MIN_THREE_D_VERTEX_BUDGETS : MIN_VERTEX_BUDGETS;
  const maximums = threeD ? THREE_D_VERTEX_BUDGETS : RESOLUTION_VERTEX_BUDGETS;
  const progress = smoothstep((zoom - BUDGET_ZOOM_MIN) / (BUDGET_ZOOM_MAX - BUDGET_ZOOM_MIN));
  const target = minimums[resolution] + (maximums[resolution] - minimums[resolution]) * progress;
  return Math.round(target / BUDGET_QUANTUM) * BUDGET_QUANTUM;
}

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
