import type { ViewportBounds } from "./contracts";

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

const WEB_MERCATOR_RADIUS_METERS = 6_378_137;
const WEB_MERCATOR_CIRCUMFERENCE_METERS = 2 * Math.PI * WEB_MERCATOR_RADIUS_METERS;
const WEB_MERCATOR_WORLD_PIXELS_AT_ZOOM_ZERO = 512;
const MAX_MERCATOR_LATITUDE = 85.05112878;

function mercatorY(latitude: number): number {
  const clamped = Math.max(-MAX_MERCATOR_LATITUDE, Math.min(MAX_MERCATOR_LATITUDE, latitude));
  const radians = (clamped * Math.PI) / 180;
  return WEB_MERCATOR_RADIUS_METERS * Math.log(Math.tan(Math.PI / 4 + radians / 2));
}

function mercatorWidth(west: number, east: number): number {
  const degrees = east >= west ? east - west : 360 - west + east;
  return (degrees / 360) * WEB_MERCATOR_CIRCUMFERENCE_METERS;
}

/**
 * Effective map resolution from the actual projected viewport and its rendered CSS size.
 * This is intentionally measured in Web Mercator meters because compiler simplification
 * tolerances use the same coordinate system.
 */
export function metersPerPixelForViewport(
  bounds: ViewportBounds,
  widthCssPixels: number,
  heightCssPixels: number,
): number {
  if (widthCssPixels <= 0 || heightCssPixels <= 0) return Number.POSITIVE_INFINITY;
  const [west, south, east, north] = bounds;
  const horizontal = mercatorWidth(west, east) / widthCssPixels;
  const vertical = Math.abs(mercatorY(north) - mercatorY(south)) / heightCssPixels;
  return Math.max(horizontal, vertical);
}

/** Projected meters represented by one rendered CSS pixel at a Web Mercator zoom. */
export function metersPerPixel(zoom: number): number {
  return WEB_MERCATOR_CIRCUMFERENCE_METERS / (WEB_MERCATOR_WORLD_PIXELS_AT_ZOOM_ZERO * 2 ** zoom);
}

function lodForMetersPerPixel(pixelMeters: number): Lod {
  for (let lod = 0; lod < LOD_TOLERANCES_METERS.length - 1; lod += 1) {
    const tolerance = LOD_TOLERANCES_METERS[lod];
    if (tolerance != null && tolerance <= pixelMeters) return lod as Lod;
  }
  return MAX_LOD;
}

/**
 * Choose the coarsest fixed-tolerance LOD whose projected simplification error is below
 * one rendered CSS pixel. For the current unpitched Web Mercator camera, zoom-derived
 * projected resolution is mathematically equivalent to projected viewport extent / CSS size.
 */
export function lodForView(zoom: number, _latitude?: number): Lod {
  return lodForMetersPerPixel(metersPerPixel(zoom));
}

export function lodForViewport(
  bounds: ViewportBounds,
  widthCssPixels: number,
  heightCssPixels: number,
): Lod {
  return lodForMetersPerPixel(
    metersPerPixelForViewport(bounds, widthCssPixels, heightCssPixels),
  );
}

export function chooseLod(estimates: readonly number[], fidelityLod: Lod, budget: number): Lod {
  let planned: Lod = fidelityLod;
  while (planned > 0 && (estimates[planned] ?? Number.POSITIVE_INFINITY) > budget) {
    planned = (planned - 1) as Lod;
  }
  return planned;
}
