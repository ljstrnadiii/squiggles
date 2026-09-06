import type { BinaryRouteBatch, HeatPalette, MapState, RouteActivity } from "./contracts";

type Color = [number, number, number, number];
type Cell = { x: number; y: number; total: number };
type WorldPoint = { x: number; y: number };
export type HeatResult = { scores: Map<string, number>; sourceVertices: number; cellCount: number; maxScore: number; durationMs: number };

export type CooperativeHeatResult = HeatResult & { yieldCount: number; maxSliceMs: number };

export const HEAT_COLOR_RANGES: Record<HeatPalette, Color[]> = {
  sunset: [[48, 64, 171, 210], [66, 132, 226, 220], [83, 205, 218, 230], [255, 217, 102, 240], [255, 112, 67, 250], [226, 48, 92, 255]],
  viridis: [[68, 1, 84, 210], [59, 82, 139, 220], [33, 145, 140, 230], [94, 201, 98, 242], [253, 231, 37, 255]],
  fire: [[34, 16, 52, 210], [87, 15, 109, 220], [187, 55, 84, 235], [249, 142, 9, 248], [252, 255, 164, 255]],
  ice: [[8, 29, 88, 210], [28, 89, 156, 220], [40, 181, 192, 235], [151, 235, 220, 248], [240, 253, 250, 255]],
};

export function colorForWeight(weight: number, maximum: number, palette: HeatPalette, temperature = 1.7): Color {
  const colors = HEAT_COLOR_RANGES[palette];
  const logarithmic = maximum <= 0 ? 0 : Math.log1p(weight) / Math.log1p(maximum);
  const scaled = Math.pow(logarithmic, 1 / Math.max(0.25, temperature));
  const position = scaled * (colors.length - 1);
  const lower = Math.floor(position);
  const upper = Math.min(colors.length - 1, lower + 1);
  const ratio = position - lower;
  return colors[lower].map((value, index) => Math.round(value + (colors[upper][index] - value) * ratio)) as Color;
}

function worldPoint(longitude: number, rawLatitude: number, worldSize: number): WorldPoint {
  const latitude = Math.max(-85.051129, Math.min(85.051129, rawLatitude)) * Math.PI / 180;
  return {
    x: (longitude + 180) / 360 * worldSize,
    y: (1 - Math.log(Math.tan(latitude) + 1 / Math.cos(latitude)) / Math.PI) / 2 * worldSize,
  };
}

function visibleWorldPoint(point: WorldPoint, view: MapState, width: number, height: number, worldSize: number, marginPixels: number): boolean {
  const center = worldPoint(view.longitude, view.latitude, worldSize);
  const directX = Math.abs(point.x - center.x);
  const wrappedX = Math.min(directX, worldSize - directX);
  return wrappedX <= width / 2 + marginPixels && Math.abs(point.y - center.y) <= height / 2 + marginPixels;
}

function heatCell(longitude: number, latitude: number, view: MapState, width: number, height: number, worldSize: number, cellPixels: number): Cell | null {
  const point = worldPoint(longitude, latitude, worldSize);
  if (!visibleWorldPoint(point, view, width, height, worldSize, cellPixels)) return null;
  return { x: Math.floor(point.x / cellPixels), y: Math.floor(point.y / cellPixels), total: 0 };
}

function visibleVertexCount(ownCells: Map<string, number>) {
  let count = 0;
  for (const value of ownCells.values()) count += value;
  return count;
}

/**
 * Score complete routes from only the settled visible viewport. Geometry may
 * come from an enclosing viewport cache entry; off-screen cached vertices do
 * not affect heat scores or the color-scale maximum. Scores are normalized by
 * each route's visible vertex count so long routes do not become artificially
 * hotter simply because they contribute more points.
 */
export function buildHeatData(activities: RouteActivity[], view: MapState, width: number, height: number, cellPixels = 8): HeatResult {
  const started = performance.now();
  const empty = { scores: new Map<string, number>(), sourceVertices: 0, cellCount: 0, maxScore: 0, durationMs: 0 };
  if (!width || !height || !activities.length) return { ...empty, durationMs: performance.now() - started };
  const worldSize = 512 * 2 ** view.zoom;
  const key = (x: number, y: number) => `${x}:${y}`;
  const globalCells = new Map<string, Cell>();
  const activityCells: Map<string, number>[] = [];
  let sourceVertices = 0;
  for (const activity of activities) {
    const ownCells = new Map<string, number>();
    for (const position of activity.path) {
      const cell = heatCell(position[0], position[1], view, width, height, worldSize, cellPixels);
      if (!cell) continue;
      const cellKey = key(cell.x, cell.y);
      const existing = globalCells.get(cellKey);
      if (existing) existing.total += 1;
      else globalCells.set(cellKey, { ...cell, total: 1 });
      ownCells.set(cellKey, (ownCells.get(cellKey) ?? 0) + 1);
      sourceVertices += 1;
    }
    activityCells.push(ownCells);
  }
  const scores = new Map<string, number>();
  let maxScore = 0;
  activities.forEach((activity, activityIndex) => {
    const ownCells = activityCells[activityIndex];
    let totalOverlap = 0;
    for (const [cellKey, ownVertexCount] of ownCells) {
      const cell = globalCells.get(cellKey)!;
      let otherVertexCount = 0;
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          const neighborKey = key(cell.x + dx, cell.y + dy);
          otherVertexCount += (globalCells.get(neighborKey)?.total ?? 0) - (ownCells.get(neighborKey) ?? 0);
        }
      }
      totalOverlap += ownVertexCount * Math.max(0, otherVertexCount);
    }
    const routeVertices = visibleVertexCount(ownCells);
    const score = routeVertices > 0 ? totalOverlap / routeVertices : 0;
    scores.set(activity.activityId, score);
    maxScore = Math.max(maxScore, score);
  });
  return { scores, sourceVertices, cellCount: globalCells.size, maxScore, durationMs: performance.now() - started };
}

/** Score GeoArrow coordinate buffers directly, without materializing points. */
export function buildBinaryHeatData(batches: BinaryRouteBatch[], view: MapState, width: number, height: number, excludedActivityId?: string, cellPixels = 8): HeatResult {
  const started = performance.now();
  const empty = { scores: new Map<string, number>(), sourceVertices: 0, cellCount: 0, maxScore: 0, durationMs: 0 };
  if (!width || !height || !batches.length) return { ...empty, durationMs: performance.now() - started };
  const worldSize = 512 * 2 ** view.zoom;
  const key = (x: number, y: number) => `${x}:${y}`;
  const globalCells = new Map<string, Cell>();
  const activityCells = new Map<string, Map<string, number>>();
  let sourceVertices = 0;
  for (const batch of batches) {
    for (let segment = 0; segment < batch.segmentActivityIndices.length; segment += 1) {
      const activity = batch.activities[batch.segmentActivityIndices[segment]];
      if (!activity || activity.activityId === excludedActivityId) continue;
      let ownCells = activityCells.get(activity.activityId);
      if (!ownCells) { ownCells = new Map(); activityCells.set(activity.activityId, ownCells); }
      const start = batch.startIndices[segment];
      const end = batch.startIndices[segment + 1];
      for (let point = start; point < end; point += 1) {
        const longitude = batch.positions[point * 2];
        const latitude = batch.positions[point * 2 + 1];
        if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) continue;
        const cell = heatCell(longitude, latitude, view, width, height, worldSize, cellPixels);
        if (!cell) continue;
        const cellKey = key(cell.x, cell.y);
        const existing = globalCells.get(cellKey);
        if (existing) existing.total += 1;
        else globalCells.set(cellKey, { ...cell, total: 1 });
        ownCells.set(cellKey, (ownCells.get(cellKey) ?? 0) + 1);
        sourceVertices += 1;
      }
    }
  }
  const scores = new Map<string, number>();
  let maxScore = 0;
  for (const [activityId, ownCells] of activityCells) {
    let totalOverlap = 0;
    for (const [cellKey, ownVertexCount] of ownCells) {
      const cell = globalCells.get(cellKey)!;
      let otherVertexCount = 0;
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          const neighborKey = key(cell.x + dx, cell.y + dy);
          otherVertexCount += (globalCells.get(neighborKey)?.total ?? 0) - (ownCells.get(neighborKey) ?? 0);
        }
      }
      totalOverlap += ownVertexCount * Math.max(0, otherVertexCount);
    }
    const routeVertices = visibleVertexCount(ownCells);
    const score = routeVertices > 0 ? totalOverlap / routeVertices : 0;
    scores.set(activityId, score);
    maxScore = Math.max(maxScore, score);
  }
  return { scores, sourceVertices, cellCount: globalCells.size, maxScore, durationMs: performance.now() - started };
}

function yieldToBrowser(): Promise<void> {
  const scheduler = (globalThis as typeof globalThis & { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (scheduler?.yield) return scheduler.yield();
  return new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * Score the settled visible viewport from retained binary coordinates while
 * periodically yielding the main thread. Cached geometry outside the viewport
 * is ignored rather than allowed to influence the current heat scale.
 */
export async function buildBinaryHeatDataCooperative(
  batches: BinaryRouteBatch[],
  view: MapState,
  width: number,
  height: number,
  excludedActivityId?: string,
  cellPixels = 8,
  shouldCancel: () => boolean = () => false,
  sliceBudgetMs = 8,
): Promise<CooperativeHeatResult | null> {
  const started = performance.now();
  const empty = { scores: new Map<string, number>(), sourceVertices: 0, cellCount: 0, maxScore: 0, durationMs: 0, yieldCount: 0, maxSliceMs: 0 };
  if (!width || !height || !batches.length) return { ...empty, durationMs: performance.now() - started };
  const worldSize = 512 * 2 ** view.zoom;
  const key = (x: number, y: number) => `${x}:${y}`;
  const globalCells = new Map<string, Cell>();
  const activityCells = new Map<string, Map<string, number>>();
  let sourceVertices = 0;
  let yieldCount = 0;
  let maxSliceMs = 0;
  let sliceStarted = performance.now();
  let operations = 0;
  const cooperate = async () => {
    const sliceMs = performance.now() - sliceStarted;
    if (sliceMs < sliceBudgetMs) return true;
    maxSliceMs = Math.max(maxSliceMs, sliceMs);
    yieldCount += 1;
    await yieldToBrowser();
    sliceStarted = performance.now();
    return !shouldCancel();
  };

  for (const batch of batches) {
    for (let segment = 0; segment < batch.segmentActivityIndices.length; segment += 1) {
      const activity = batch.activities[batch.segmentActivityIndices[segment]];
      if (!activity || activity.activityId === excludedActivityId) continue;
      let ownCells = activityCells.get(activity.activityId);
      if (!ownCells) { ownCells = new Map(); activityCells.set(activity.activityId, ownCells); }
      const start = batch.startIndices[segment];
      const end = batch.startIndices[segment + 1];
      for (let point = start; point < end; point += 1) {
        const longitude = batch.positions[point * 2];
        const latitude = batch.positions[point * 2 + 1];
        if (Number.isFinite(longitude) && Number.isFinite(latitude)) {
          const cell = heatCell(longitude, latitude, view, width, height, worldSize, cellPixels);
          if (cell) {
            const cellKey = key(cell.x, cell.y);
            const existing = globalCells.get(cellKey);
            if (existing) existing.total += 1;
            else globalCells.set(cellKey, { ...cell, total: 1 });
            ownCells.set(cellKey, (ownCells.get(cellKey) ?? 0) + 1);
            sourceVertices += 1;
          }
        }
        operations += 1;
        if ((operations & 4095) === 0 && !await cooperate()) return null;
      }
    }
  }

  const scores = new Map<string, number>();
  let maxScore = 0;
  for (const [activityId, ownCells] of activityCells) {
    let totalOverlap = 0;
    for (const [cellKey, ownVertexCount] of ownCells) {
      const cell = globalCells.get(cellKey)!;
      let otherVertexCount = 0;
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          const neighborKey = key(cell.x + dx, cell.y + dy);
          otherVertexCount += (globalCells.get(neighborKey)?.total ?? 0) - (ownCells.get(neighborKey) ?? 0);
        }
      }
      totalOverlap += ownVertexCount * Math.max(0, otherVertexCount);
      operations += 1;
      if ((operations & 4095) === 0 && !await cooperate()) return null;
    }
    const routeVertices = visibleVertexCount(ownCells);
    const score = routeVertices > 0 ? totalOverlap / routeVertices : 0;
    scores.set(activityId, score);
    maxScore = Math.max(maxScore, score);
  }
  maxSliceMs = Math.max(maxSliceMs, performance.now() - sliceStarted);
  return { scores, sourceVertices, cellCount: globalCells.size, maxScore, durationMs: performance.now() - started, yieldCount, maxSliceMs };
}
