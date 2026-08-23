import type { RouteActivity } from "./contracts";

export type RouteSegment = { activity: RouteActivity; path: [number, number][] };
export type RouteLineWidths = { route: number; heat: number; focus: number; casing: number };

/** Keep strokes proportional to the shorter map dimension at every zoom. */
export function lineWidthsForViewport(thicknessScale: number, width: number, height: number): RouteLineWidths {
  const viewportBasis = Math.max(320, Math.min(width, height));
  const route = viewportBasis * 0.0015 * thicknessScale;
  const focus = Math.max(route * 1.6, route + 1.2);
  return {
    route,
    heat: route,
    focus,
    casing: focus + Math.max(1, viewportBasis * 0.0015),
  };
}

function distanceMeters(a: [number, number], b: [number, number]) {
  const radians = Math.PI / 180;
  const dLatitude = (b[1] - a[1]) * radians;
  const dLongitude = (b[0] - a[0]) * radians;
  const latitudeA = a[1] * radians;
  const latitudeB = b[1] * radians;
  const value = Math.sin(dLatitude / 2) ** 2 + Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(dLongitude / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

/** Avoid rendering a fabricated line across a corrupt or missing track section. */
export function splitDiscontinuities(path: [number, number][], maximumLegMeters = 20000) {
  if (path.length < 2) return [];
  const segments: [number, number][][] = [];
  let segment: [number, number][] = [path[0]];
  for (let index = 1; index < path.length; index += 1) {
    if (distanceMeters(path[index - 1], path[index]) > maximumLegMeters) {
      if (segment.length >= 2) segments.push(segment);
      segment = [path[index]];
    } else {
      segment.push(path[index]);
    }
  }
  if (segment.length >= 2) segments.push(segment);
  return segments;
}

export function routeSegments(activities: RouteActivity[], full = false): RouteSegment[] {
  return activities.flatMap(activity => splitDiscontinuities(full ? activity.fullPath : activity.path).map(path => ({ activity, path })));
}
