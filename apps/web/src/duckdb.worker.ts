/// <reference lib="webworker" />
import * as duckdb from "@duckdb/duckdb-wasm";

import { canonicalSourceSql } from "./canonicalSource";
import type {
  BinaryRouteBatch,
  ResolutionRenderPlans,
  RouteMetadata,
  SystemResolution,
} from "./contracts";
import { RESOLUTION_VERTEX_BUDGETS, type Lod } from "./lod";
import { isUniversalSelectionSql } from "./selection";

type Bounds = [number, number, number, number];
type ArrowData = {
  valueOffsets?: unknown;
  values?: unknown;
  stride: number;
  children: ArrowData[];
};
type ArrowVector = {
  data: readonly ArrowData[];
  get(index: number): unknown;
};
type ArrowBatch = {
  numRows: number;
  getChild(name: string): ArrowVector | null;
};
type ArrowTable = { batches: readonly ArrowBatch[] };
type RegisteredRowGroup = {
  rowCount: number;
  bbox: Bounds;
  vertexSum?: number;
  cleanVertexSum?: number;
};
type RegisteredFile = {
  name: string;
  buffer?: ArrayBuffer;
  url?: string;
  bbox?: Bounds;
  byteSize: number;
  rowCount: number;
  rowGroups?: RegisteredRowGroup[];
};
type Request =
  | {
      id: number;
      type: "open";
      files: RegisteredFile[];
      metadataFiles: RegisteredFile[];
      renderLevels: { lod: Lod; files: RegisteredFile[] }[];
      schemaVersion: string;
    }
  | {
      id: number;
      type: "execute";
      sql: string;
      lod: Lod;
      resolution: SystemResolution;
      bounds?: Bounds;
      clean: boolean;
      startingVertexEstimate?: number;
      needsCanonicalGeometry: boolean;
    }
  | {
      id: number;
      type: "render";
      lod: Lod;
      resolution: SystemResolution;
      bounds: Bounds;
      clean: boolean;
    }
  | { id: number; type: "summary"; bounds?: Bounds; clean: boolean }
  | { id: number; type: "table"; bounds?: Bounds; clean: boolean }
  | { id: number; type: "metadata"; activityId: string; clean: boolean }
  | { id: number; type: "activity"; activityId: string; clean: boolean };

let database: duckdb.AsyncDuckDB | null = null;
let connection: duckdb.AsyncDuckDBConnection | null = null;
let supportsClean = false;
let cleanViewEnabled = false;
let selectionAll = false;
let registeredFiles: RegisteredFile[] = [];
let registeredCanonicalFiles: RegisteredFile[] = [];
let canonicalViewReady = false;
let registeredRenderLevels = new Map<Lod, RegisteredFile[]>();
let initializationTimings = { selectBundleMs: 0, instantiateMs: 0, connectMs: 0 };

const scalar = (value: unknown) => (typeof value === "bigint" ? Number(value) : value);
const coordinates = (value: unknown): [number, number][] =>
  value == null
    ? []
    : Array.from(value as Iterable<Iterable<number>>, (pair) => Array.from(pair) as [number, number]);

function distanceMeters(a: [number, number], b: [number, number]): number {
  const radians = Math.PI / 180;
  const dLatitude = (b[1] - a[1]) * radians;
  const dLongitude = (b[0] - a[0]) * radians;
  const latitudeA = a[1] * radians;
  const latitudeB = b[1] * radians;
  const value =
    Math.sin(dLatitude / 2) ** 2 +
    Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(dLongitude / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function elevationProfile(value: unknown) {
  const samples: { distanceM: number; elevationM: number; position: [number, number] }[] = [];
  let previous: [number, number] | null = null;
  let distanceM = 0;
  for (const raw of value == null ? [] : Array.from(value as Iterable<Iterable<number | null>>)) {
    const [longitude, latitude, elevation] = Array.from(raw);
    if (longitude == null || latitude == null) continue;
    const position: [number, number] = [Number(longitude), Number(latitude)];
    if (previous) distanceM += distanceMeters(previous, position);
    previous = position;
    if (elevation != null && Number.isFinite(Number(elevation))) {
      samples.push({ distanceM, elevationM: Number(elevation), position });
    }
  }
  return samples;
}

function detailRoute(row: Record<string, unknown>, geometryKey: string) {
  const path = coordinates(row[geometryKey]);
  return {
    activityId: String(scalar(row.activity_id)),
    name: String(row.name),
    sportType: String(row.sport_type),
    startTime: row.start_time?.toString() ?? null,
    distanceM: scalar(row.distance_m) as number | null,
    elevationGainM: scalar(row.elevation_gain_m) as number | null,
    maxElevationM: scalar(row.max_elevation_m) as number | null,
    sourceUrl: row.source_url as string | null,
    path,
    fullPath: row.geometry == null ? path : coordinates(row.geometry),
    elevationProfile: elevationProfile(row.elevation_profile),
  };
}

function column(batch: ArrowBatch, name: string): ArrowVector {
  const value = batch.getChild(name);
  if (!value) throw new Error(`Viewport result is missing ${name}`);
  return value;
}

function metadataAt(columns: Map<string, ArrowVector>, index: number): RouteMetadata {
  const activityId = String(scalar(columns.get("activity_id")!.get(index)));
  return {
    activityId,
    name: "",
    sportType: "",
    startTime: null,
    distanceM: null,
    elevationGainM: null,
    maxElevationM: null,
    sourceUrl: null,
  };
}

function materializedRouteBatch(
  batch: ArrowBatch,
  geometry: ArrowVector,
  columns: Map<string, ArrowVector>,
): BinaryRouteBatch {
  const positions: number[] = [];
  const starts: number[] = [];
  const owners: number[] = [];
  for (let activityIndex = 0; activityIndex < batch.numRows; activityIndex += 1) {
    const route = coordinates(geometry.get(activityIndex));
    if (!route.length) continue;
    starts.push(positions.length / 2);
    owners.push(activityIndex);
    for (let point = 0; point < route.length; point += 1) {
      if (point > 0 && distanceMeters(route[point - 1], route[point]) > 20_000) {
        starts.push(positions.length / 2);
        owners.push(activityIndex);
      }
      positions.push(route[point][0], route[point][1]);
    }
  }
  starts.push(positions.length / 2);
  return {
    activities: Array.from({ length: batch.numRows }, (_, index) => metadataAt(columns, index)),
    positions: Float64Array.from(positions),
    startIndices: Uint32Array.from(starts),
    segmentActivityIndices: Uint32Array.from(owners),
  };
}

export function binaryRouteBatches(table: ArrowTable, geometryName: string): BinaryRouteBatch[] {
  return table.batches.map((batch) => {
    const names = ["activity_id"];
    const columns = new Map(names.map((name) => [name, column(batch, name)]));
    const geometry = column(batch, geometryName);
    if (geometry.data.length !== 1) return materializedRouteBatch(batch, geometry, columns);

    const lineData = geometry.data[0];
    const offsets = lineData.valueOffsets;
    const fixedCoordinates = lineData.children[0];
    const primitiveCoordinates = fixedCoordinates?.children[0];
    const values = primitiveCoordinates?.values;
    const pairOffsets =
      fixedCoordinates?.valueOffsets instanceof Int32Array ? fixedCoordinates.valueOffsets : null;
    const fixedPairs = fixedCoordinates?.stride === 2;
    if (
      !(offsets instanceof Int32Array) ||
      !(values instanceof Float64Array) ||
      (!fixedPairs && pairOffsets === null)
    ) {
      return materializedRouteBatch(batch, geometry, columns);
    }

    const firstPoint = offsets[0];
    const lastPoint = offsets[batch.numRows];
    const firstValue = fixedPairs ? firstPoint * 2 : pairOffsets![firstPoint];
    const lastValue = fixedPairs ? lastPoint * 2 : pairOffsets![lastPoint];
    if (!fixedPairs) {
      for (let point = firstPoint; point < lastPoint; point += 1) {
        if (pairOffsets![point + 1] - pairOffsets![point] !== 2) {
          throw new Error(
            "Viewport GeoArrow coordinates must contain exactly longitude and latitude",
          );
        }
      }
    }

    const positions = values.subarray(firstValue, lastValue);
    const starts: number[] = [];
    const owners: number[] = [];
    for (let activityIndex = 0; activityIndex < batch.numRows; activityIndex += 1) {
      const routeStart = offsets[activityIndex] - firstPoint;
      const routeEnd = offsets[activityIndex + 1] - firstPoint;
      if (routeEnd <= routeStart) continue;
      starts.push(routeStart);
      owners.push(activityIndex);
      for (let point = routeStart + 1; point < routeEnd; point += 1) {
        const previous: [number, number] = [
          positions[(point - 1) * 2],
          positions[(point - 1) * 2 + 1],
        ];
        const current: [number, number] = [positions[point * 2], positions[point * 2 + 1]];
        if (distanceMeters(previous, current) > 20_000) {
          starts.push(point);
          owners.push(activityIndex);
        }
      }
    }
    starts.push(positions.length / 2);
    return {
      activities: Array.from({ length: batch.numRows }, (_, index) => metadataAt(columns, index)),
      positions,
      startIndices: Uint32Array.from(starts),
      segmentActivityIndices: Uint32Array.from(owners),
    };
  });
}

function transferables(value: unknown): Transferable[] {
  if (!value || typeof value !== "object" || !("batches" in value)) return [];
  const buffers = new Set<ArrayBuffer>();
  for (const batch of (value as { batches: BinaryRouteBatch[] }).batches) {
    for (const array of [batch.positions, batch.startIndices, batch.segmentActivityIndices]) {
      if (array.buffer instanceof ArrayBuffer) buffers.add(array.buffer);
    }
  }
  return [...buffers];
}

function respond(id: number, value: unknown) {
  self.postMessage({ id, ok: true, value }, transferables(value));
}

async function initialize() {
  if (database) return database;
  const bundles: duckdb.DuckDBBundles = {
    mvp: {
      mainModule: new URL("@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm", import.meta.url).href,
      mainWorker: new URL(
        "@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js",
        import.meta.url,
      ).href,
    },
    eh: {
      mainModule: new URL("@duckdb/duckdb-wasm/dist/duckdb-eh.wasm", import.meta.url).href,
      mainWorker: new URL(
        "@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js",
        import.meta.url,
      ).href,
    },
  };
  const selectStarted = performance.now();
  const bundle = await duckdb.selectBundle(bundles);
  const selectBundleMs = performance.now() - selectStarted;
  database = new duckdb.AsyncDuckDB(
    new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING),
    new Worker(bundle.mainWorker!),
  );
  const instantiateStarted = performance.now();
  await database.instantiate(bundle.mainModule, bundle.pthreadWorker);
  const instantiateMs = performance.now() - instantiateStarted;
  const connectStarted = performance.now();
  connection = await database.connect();
  await connection.query("INSTALL spatial; LOAD spatial");
  const connectMs = performance.now() - connectStarted;
  initializationTimings = { selectBundleMs, instantiateMs, connectMs };
  return database;
}

function viewportPredicate(bounds?: Bounds, clean = false): string {
  if (!bounds) return "TRUE";
  if (!bounds.every(Number.isFinite)) throw new Error("Viewport bounds are invalid");
  const [west, south, east, north] = bounds;
  const prefix = clean ? "clean_" : "";
  const longitude =
    west <= east
      ? `a.${prefix}xmax >= ${west} AND a.${prefix}xmin <= ${east}`
      : `(a.${prefix}xmax >= ${west} OR a.${prefix}xmin <= ${east})`;
  return `${longitude} AND a.${prefix}ymax >= ${south} AND a.${prefix}ymin <= ${north}`;
}

function viewportContainmentPredicate(bounds?: Bounds, clean = false): string {
  if (!bounds) return "TRUE";
  if (!bounds.every(Number.isFinite)) throw new Error("Viewport bounds are invalid");
  const [west, south, east, north] = bounds;
  const prefix = clean ? "clean_" : "";
  const longitude =
    west <= east
      ? `a.${prefix}xmin >= ${west} AND a.${prefix}xmax <= ${east}`
      : `(a.${prefix}xmin >= ${west} OR a.${prefix}xmax <= ${east})`;
  return `${longitude} AND a.${prefix}ymin >= ${south} AND a.${prefix}ymax <= ${north}`;
}

function boundsIntersect(left: Bounds | undefined, right: Bounds | undefined): boolean {
  if (!left || !right) return true;
  const [xmin, ymin, xmax, ymax] = left;
  const [west, south, east, north] = right;
  const longitude = west <= east ? xmax >= west && xmin <= east : xmax >= west || xmin <= east;
  return longitude && ymax >= south && ymin <= north;
}

function viewportScan(bounds?: Bounds, source = registeredFiles) {
  const files = bounds ? source.filter((file) => boundsIntersect(file.bbox, bounds)) : source;
  const groups = (file: RegisteredFile): RegisteredRowGroup[] =>
    file.rowGroups?.length
      ? file.rowGroups
      : [{ rowCount: file.rowCount, bbox: file.bbox ?? [-180, -90, 180, 90] }];
  const candidateGroups = files.flatMap(groups);
  const expectedGroups = bounds
    ? candidateGroups.filter((group) => boundsIntersect(group.bbox, bounds))
    : candidateGroups;
  return {
    files,
    metrics: {
      candidateFragmentCount: files.length,
      totalFragmentCount: source.length,
      candidateBytes: files.reduce((sum, file) => sum + file.byteSize, 0),
      totalBytes: source.reduce((sum, file) => sum + file.byteSize, 0),
      expectedRowGroupCount: expectedGroups.length,
      candidateRowGroupCount: candidateGroups.length,
      totalRowGroupCount: source.flatMap(groups).length,
      expectedRowCount: expectedGroups.reduce((sum, group) => sum + group.rowCount, 0),
      keptRowCount: 0,
    },
  };
}

function parquetRelation(files: RegisteredFile[], hivePartitioning: boolean): string | null {
  if (files.length === 0) return null;
  const paths = files.map((file) => `'${file.name.replaceAll("'", "''")}'`).join(",");
  return `read_parquet([${paths}],hive_partitioning=${hivePartitioning})`;
}

function viewportRelation(files: RegisteredFile[], clean: boolean): string | null {
  const source = parquetRelation(files, false);
  if (!source) return null;
  if (!clean) return source;
  return `(SELECT * REPLACE (
    coalesce(clean_distance_m,distance_m) AS distance_m,
    coalesce(clean_elevation_gain_m,elevation_gain_m) AS elevation_gain_m,
    coalesce(clean_elevation_loss_m,elevation_loss_m) AS elevation_loss_m,
    coalesce(clean_min_elevation_m,min_elevation_m) AS min_elevation_m,
    coalesce(clean_max_elevation_m,max_elevation_m) AS max_elevation_m,
    clean_point_count AS point_count,
    clean_xmin AS xmin, clean_ymin AS ymin, clean_xmax AS xmax, clean_ymax AS ymax
  ) FROM ${source})`;
}

async function configureActivitiesView(clean: boolean) {
  const enabled = clean && supportsClean;
  if (enabled === cleanViewEnabled) return;
  if (!enabled) {
    await connection!.query("CREATE OR REPLACE TEMP VIEW activities AS SELECT * FROM activity_source");
  } else {
    await connection!.query(`CREATE OR REPLACE TEMP VIEW activities AS SELECT * REPLACE (
      coalesce(clean_distance_m,distance_m) AS distance_m,
      coalesce(clean_elevation_gain_m,elevation_gain_m) AS elevation_gain_m,
      coalesce(clean_elevation_loss_m,elevation_loss_m) AS elevation_loss_m,
      coalesce(clean_min_elevation_m,min_elevation_m) AS min_elevation_m,
      coalesce(clean_max_elevation_m,max_elevation_m) AS max_elevation_m,
      clean_point_count AS point_count,
      clean_xmin AS xmin, clean_ymin AS ymin, clean_xmax AS xmax, clean_ymax AS ymax
    ) FROM activity_source`);
  }
  cleanViewEnabled = enabled;
}

async function ensureCanonicalGeometry(clean: boolean) {
  if (!canonicalViewReady) {
    await connection!.query(
      `CREATE OR REPLACE VIEW canonical_source AS ${canonicalSourceSql(registeredCanonicalFiles)}`,
    );
    canonicalViewReady = true;
  }
  const geometry = clean ? "geometry_clean AS geometry" : "geometry";
  await connection!.query(
    `CREATE OR REPLACE TEMP VIEW activity_geometry AS SELECT activity_id,${geometry},xmin,ymin,xmax,ymax,clean_xmin,clean_ymin,clean_xmax,clean_ymax FROM canonical_source`,
  );
}

function selectionJoin(): string {
  return selectionAll ? "" : " SEMI JOIN current_selection s USING(activity_id)";
}

function renderFiles(level: Lod): RegisteredFile[] {
  return registeredRenderLevels.get(level) ?? [];
}

function manifestVertexEstimate(
  level: Lod,
  bounds: Bounds | undefined,
  clean: boolean,
): number | null {
  const { files } = viewportScan(bounds, renderFiles(level));
  let total = 0;
  for (const file of files) {
    for (const group of file.rowGroups ?? []) {
      if (bounds && !boundsIntersect(group.bbox, bounds)) continue;
      const vertices = clean ? group.cleanVertexSum ?? group.vertexSum : group.vertexSum;
      if (vertices == null) return null;
      total += vertices;
    }
  }
  return total;
}

function availableRenderLods(): Lod[] {
  return [...registeredRenderLevels.keys()].sort((left, right) => left - right);
}

function clampAvailableLod(requested: Lod): Lod {
  const levels = availableRenderLods();
  if (!levels.length) {
    throw new Error("Dataset has no render pyramid; recompile it with the current compiler");
  }
  return levels.filter((level) => level <= requested).at(-1) ?? levels[0];
}

function previousAvailableLod(current: Lod): Lod | null {
  return availableRenderLods().filter((level) => level < current).at(-1) ?? null;
}

async function exactVertexEstimate(
  level: Lod,
  bounds: Bounds | undefined,
  clean: boolean,
): Promise<number> {
  const { files } = viewportScan(bounds, renderFiles(level));
  const relation = parquetRelation(files, false);
  if (!relation) return 0;
  const geometryCount = clean ? "clean_vertex_count" : "vertex_count";
  const estimate = await connection!.query(
    `SELECT coalesce(sum(a.${geometryCount}),0) total FROM ${relation} a${selectionJoin()} WHERE ${viewportPredicate(bounds, clean)}`,
  );
  const row = estimate.toArray()[0] as unknown as Record<string, unknown>;
  return Number(scalar(row.total));
}

async function planResolutionLods(
  requested: Lod,
  bounds: Bounds | undefined,
  clean: boolean,
  startingEstimate?: number,
): Promise<ResolutionRenderPlans> {
  const plans = {} as Partial<ResolutionRenderPlans>;
  const estimates = new Map<Lod, number>();
  let level = clampAvailableLod(requested);
  if (startingEstimate != null) estimates.set(level, startingEstimate);

  while (true) {
    let estimate = estimates.get(level);
    if (estimate == null) {
      const manifestEstimate = manifestVertexEstimate(level, bounds, clean);
      estimate =
        selectionAll && manifestEstimate != null
          ? manifestEstimate
          : await exactVertexEstimate(level, bounds, clean);
      estimates.set(level, estimate);
    }

    for (const resolution of ["high", "medium", "low"] as const) {
      if (!plans[resolution] && estimate <= RESOLUTION_VERTEX_BUDGETS[resolution]) {
        plans[resolution] = { lod: level, vertexEstimate: estimate };
      }
    }

    if (plans.low && plans.medium && plans.high) break;
    const previous = previousAvailableLod(level);
    if (previous == null) {
      for (const resolution of ["low", "medium", "high"] as const) {
        plans[resolution] ??= { lod: level, vertexEstimate: estimate };
      }
      break;
    }
    level = previous;
  }

  return plans as ResolutionRenderPlans;
}

async function rawVertexEstimate(bounds: Bounds | undefined, fallback: number): Promise<number> {
  const full = availableRenderLods().at(-1);
  if (selectionAll && full != null) {
    return manifestVertexEstimate(full, bounds, false) ?? fallback;
  }
  if (selectionAll) return fallback;
  const estimate = await connection!.query(
    `SELECT coalesce(sum(a.point_count),0) total FROM current_selection a WHERE ${viewportPredicate(bounds)}`,
  );
  const row = estimate.toArray()[0] as unknown as Record<string, unknown>;
  return Number(scalar(row.total));
}

async function render(
  lod: Lod,
  resolution: SystemResolution,
  bounds?: Bounds,
  clean = false,
  startingEstimate?: number,
) {
  const resolutionPlans = await planResolutionLods(lod, bounds, clean, startingEstimate);
  const plan = resolutionPlans[resolution];
  const plannedLod = plan.lod;
  const scan = viewportScan(bounds, renderFiles(plannedLod));
  const rawEstimate = await rawVertexEstimate(bounds, plan.vertexEstimate);
  const vertexBudget = RESOLUTION_VERTEX_BUDGETS[resolution];

  if (scan.files.length === 0) {
    return {
      lod: plannedLod,
      batches: [],
      activityCount: 0,
      geometryBufferBytes: 0,
      vertexCount: 0,
      plannedVertexEstimate: plan.vertexEstimate,
      resolutionPlans,
      rawVertexEstimate: rawEstimate,
      vertexBudget,
      scan: scan.metrics,
    };
  }

  const relation = parquetRelation(scan.files, false);
  if (!relation) {
    return {
      lod: plannedLod,
      batches: [],
      activityCount: 0,
      geometryBufferBytes: 0,
      vertexCount: 0,
      plannedVertexEstimate: 0,
      resolutionPlans,
      rawVertexEstimate: rawEstimate,
      vertexBudget,
      scan: scan.metrics,
    };
  }

  const geometry = clean ? "geometry_clean" : "geometry";
  const result = await connection!.query(
    `SELECT a.activity_id,a.${geometry} FROM ${relation} a${selectionJoin()} WHERE ${viewportPredicate(bounds, clean)}`,
  );
  const batches = binaryRouteBatches(result, geometry);
  const vertexCount = batches.reduce((total, batch) => total + batch.positions.length / 2, 0);
  const geometryBufferBytes = batches.reduce(
    (total, batch) =>
      total +
      batch.positions.byteLength +
      batch.startIndices.byteLength +
      batch.segmentActivityIndices.byteLength,
    0,
  );
  const activityCount = batches.reduce((total, batch) => total + batch.activities.length, 0);
  return {
    lod: plannedLod,
    batches,
    activityCount,
    geometryBufferBytes,
    vertexCount,
    plannedVertexEstimate: plan.vertexEstimate,
    resolutionPlans,
    rawVertexEstimate: rawEstimate,
    vertexBudget,
    scan: { ...scan.metrics, keptRowCount: activityCount },
  };
}

async function summarize(bounds: Bounds | undefined, clean: boolean) {
  const { files } = viewportScan(bounds);
  const relation = viewportRelation(files, clean);
  if (!relation) {
    return {
      activityCount: 0,
      distanceM: 0,
      elapsedSeconds: 0,
      movingSeconds: 0,
      elevationGainM: 0,
      elevationLossM: 0,
      minElevationM: null,
      maxElevationM: null,
      maxDistanceM: null,
      activeDays: 0,
      droppedJumpPoints: 0,
      droppedElevationPoints: 0,
      sportCounts: [],
      firstActivity: null,
      lastActivity: null,
    };
  }
  const field = (cleanName: string, rawName: string) =>
    clean ? `coalesce(a.${cleanName},a.${rawName})` : `a.${rawName}`;
  const dropped = supportsClean
    ? "sum(a.dropped_jump_points) dropped_jump_points,sum(a.dropped_elevation_points) dropped_elevation_points"
    : "0 dropped_jump_points,0 dropped_elevation_points";
  const where = viewportContainmentPredicate(bounds, clean);
  const join = selectionJoin();
  const summaries = await connection!.query(
    `SELECT count(*) activity_count,coalesce(sum(${field("clean_distance_m", "distance_m")}),0) distance_m,coalesce(sum(a.elapsed_seconds),0) elapsed_seconds,coalesce(sum(a.moving_seconds),0) moving_seconds,coalesce(sum(${field("clean_elevation_gain_m", "elevation_gain_m")}),0) elevation_gain_m,coalesce(sum(${field("clean_elevation_loss_m", "elevation_loss_m")}),0) elevation_loss_m,min(${field("clean_min_elevation_m", "min_elevation_m")}) min_elevation_m,max(${field("clean_max_elevation_m", "max_elevation_m")}) max_elevation_m,max(${field("clean_distance_m", "distance_m")}) max_distance_m,count(DISTINCT substr(CAST(a.start_time AS VARCHAR),1,10)) active_days,${dropped},CAST(min(a.start_time) AS VARCHAR) first_activity,CAST(max(a.start_time) AS VARCHAR) last_activity FROM ${relation} a${join} WHERE ${where}`,
  );
  const sports = await connection!.query(
    `SELECT a.activity_family sport,count(*) activity_count FROM ${relation} a${join} WHERE ${where} GROUP BY a.activity_family ORDER BY activity_count DESC,sport`,
  );
  const row = summaries.toArray()[0] as unknown as Record<string, unknown>;
  const sportCounts = sports.toArray().map((item) => {
    const sport = item as unknown as Record<string, unknown>;
    return { sport: String(sport.sport), count: Number(scalar(sport.activity_count)) };
  });
  return {
    activityCount: Number(scalar(row.activity_count)),
    distanceM: Number(scalar(row.distance_m)),
    elapsedSeconds: Number(scalar(row.elapsed_seconds)),
    movingSeconds: Number(scalar(row.moving_seconds)),
    elevationGainM: Number(scalar(row.elevation_gain_m)),
    elevationLossM: Number(scalar(row.elevation_loss_m)),
    minElevationM: scalar(row.min_elevation_m) as number | null,
    maxElevationM: scalar(row.max_elevation_m) as number | null,
    maxDistanceM: scalar(row.max_distance_m) as number | null,
    activeDays: Number(scalar(row.active_days)),
    droppedJumpPoints: Number(scalar(row.dropped_jump_points)),
    droppedElevationPoints: Number(scalar(row.dropped_elevation_points)),
    sportCounts,
    firstActivity: row.first_activity?.toString() ?? null,
    lastActivity: row.last_activity?.toString() ?? null,
  };
}

self.onmessage = async (event: MessageEvent<Request>) => {
  const request = event.data;
  try {
    const initializeStarted = performance.now();
    const db = await initialize();
    const initializeMs = performance.now() - initializeStarted;
    if (request.type === "open") {
      registeredCanonicalFiles = request.files;
      registeredFiles = request.metadataFiles;
      registeredRenderLevels = new Map(
        request.renderLevels.map((level) => [level.lod, level.files]),
      );
      selectionAll = false;
      const renderFilesToRegister = request.renderLevels.flatMap((level) => level.files);
      const registrationStarted = performance.now();
      for (const file of [...request.files, ...request.metadataFiles, ...renderFilesToRegister]) {
        if (file.buffer) {
          await db.registerFileBuffer(file.name, new Uint8Array(file.buffer));
        } else if (file.url) {
          await db.registerFileURL(file.name, file.url, duckdb.DuckDBDataProtocol.HTTP, false);
        }
      }
      const registerFilesMs = performance.now() - registrationStarted;
      const activitySourceStarted = performance.now();
      await connection!.query(
        `CREATE OR REPLACE VIEW activity_source AS ${parquetRelation(request.metadataFiles, false)}`,
      );
      const activitySourceViewMs = performance.now() - activitySourceStarted;
      await connection!.query(`CREATE OR REPLACE VIEW canonical_source AS ${canonicalSourceSql(request.files)}`);
        const activitiesStarted = performance.now();
      await connection!.query("CREATE OR REPLACE TEMP VIEW activities AS SELECT * FROM activity_source");
      const activitiesViewMs = performance.now() - activitiesStarted;
      supportsClean = ["1.2.0", "1.3.0", "1.4.0", "1.5.0"].includes(request.schemaVersion);
      cleanViewEnabled = false;
      respond(request.id, {
        initializeMs,
        ...initializationTimings,
        registerFilesMs,
        activitySourceViewMs,
        activitiesViewMs,
      });
      return;
    }

    if (request.type === "metadata") {
      if (request.clean && !supportsClean) {
        throw new Error("Clean view requires dataset schema 1.2.0 or newer; recompile first");
      }
      await configureActivitiesView(request.clean);
      const table = await connection!.query(
        `SELECT activity_id,name,sport_type,CAST(start_time AS VARCHAR) start_time,distance_m,elevation_gain_m,max_elevation_m,source_url FROM activities WHERE activity_id='${request.activityId.replaceAll("'", "''")}' LIMIT 1`,
      );
      const row = table.toArray()[0] as unknown as Record<string, unknown> | undefined;
      self.postMessage({
        id: request.id,
        ok: true,
        value: row
          ? {
              activityId: String(scalar(row.activity_id)),
              name: String(row.name),
              sportType: String(row.sport_type),
              startTime: row.start_time?.toString() ?? null,
              distanceM: scalar(row.distance_m) as number | null,
              elevationGainM: scalar(row.elevation_gain_m) as number | null,
              maxElevationM: scalar(row.max_elevation_m) as number | null,
              sourceUrl: row.source_url as string | null,
            }
          : null,
      });
      return;
    }

    if (request.type === "activity") {
      if (request.clean && !supportsClean) {
        throw new Error("Clean view requires dataset schema 1.2.0 or newer; recompile first");
      }
      const clean = request.clean && supportsClean;
      await ensureCanonicalGeometry(clean);
      const geometry = clean ? "geometry_clean" : "geometry";
      const points = clean ? "list_filter(track_points,p->p.clean)" : "track_points";
      const table = await connection!.query(
        `SELECT activity_id,name,sport_type,CAST(start_time AS VARCHAR) start_time,${clean ? "coalesce(clean_distance_m,distance_m)" : "distance_m"} distance_m,${clean ? "coalesce(clean_elevation_gain_m,elevation_gain_m)" : "elevation_gain_m"} elevation_gain_m,${clean ? "coalesce(clean_max_elevation_m,max_elevation_m)" : "max_elevation_m"} max_elevation_m,source_url,${geometry} geometry,list_transform(${points},p->[p.longitude,p.latitude,p.elevation_m]) elevation_profile FROM canonical_source WHERE activity_id='${request.activityId.replaceAll("'", "''")}' LIMIT 1`,
      );
      const row = table.toArray()[0] as unknown as Record<string, unknown> | undefined;
      self.postMessage({
        id: request.id,
        ok: true,
        value: row ? detailRoute(row, "geometry") : null,
      });
      return;
    }

    if (request.type === "summary") {
      if (request.clean && !supportsClean) {
        throw new Error("Clean view requires dataset schema 1.2.0 or newer; recompile first");
      }
      self.postMessage({
        id: request.id,
        ok: true,
        value: await summarize(request.bounds, request.clean && supportsClean),
      });
      return;
    }

    if (request.type === "table") {
      if (request.clean && !supportsClean) {
        throw new Error("Clean view requires dataset schema 1.2.0 or newer; recompile first");
      }
      const clean = request.clean && supportsClean;
      const prefix = clean ? "clean_" : "";
      const field = (cleanName: string, rawName: string) =>
        clean ? `coalesce(a.${cleanName},a.${rawName})` : `a.${rawName}`;
      const { files } = viewportScan(request.bounds);
      const relation = viewportRelation(files, clean);
      if (!relation) {
        self.postMessage({ id: request.id, ok: true, value: [] });
        return;
      }
      const table = await connection!.query(
        `SELECT a.activity_id,a.name,a.sport_type,CAST(a.start_time AS VARCHAR) start_time,${field("clean_distance_m", "distance_m")} distance_m,${field("clean_elevation_gain_m", "elevation_gain_m")} elevation_gain_m,${field("clean_max_elevation_m", "max_elevation_m")} max_elevation_m,a.source_url,a.${prefix}xmin xmin,a.${prefix}ymin ymin,a.${prefix}xmax xmax,a.${prefix}ymax ymax FROM ${relation} a${selectionJoin()} WHERE ${viewportContainmentPredicate(request.bounds, clean)}`,
      );
      const activities = table.toArray().map((value) => {
        const row = value as unknown as Record<string, unknown>;
        return {
          activityId: String(scalar(row.activity_id)),
          name: String(row.name),
          sportType: String(row.sport_type),
          startTime: row.start_time?.toString() ?? null,
          distanceM: scalar(row.distance_m) as number | null,
          elevationGainM: scalar(row.elevation_gain_m) as number | null,
          maxElevationM: scalar(row.max_elevation_m) as number | null,
          sourceUrl: row.source_url as string | null,
          bounds: [
            Number(scalar(row.xmin)),
            Number(scalar(row.ymin)),
            Number(scalar(row.xmax)),
            Number(scalar(row.ymax)),
          ],
        };
      });
      self.postMessage({ id: request.id, ok: true, value: activities });
      return;
    }

    if (request.type === "render") {
      if (request.clean && !supportsClean) {
        throw new Error("Clean view requires dataset schema 1.2.0 or newer; recompile first");
      }
      respond(
        request.id,
        await render(request.lod, request.resolution, request.bounds, request.clean),
      );
      return;
    }

    if (request.clean && !supportsClean) {
      throw new Error("Clean view requires dataset schema 1.2.0 or newer; recompile first");
    }
    await configureActivitiesView(request.clean);
    if (request.needsCanonicalGeometry) {
      await ensureCanonicalGeometry(request.clean && supportsClean);
    }
    selectionAll = isUniversalSelectionSql(request.sql);
    if (selectionAll) {
      await connection!.query("DROP TABLE IF EXISTS current_selection");
    } else {
      const probe = await connection!.query(
        `WITH selected AS (${request.sql}) SELECT * FROM selected LIMIT 0`,
      );
      if (!probe.schema.fields.some((field) => field.name === "activity_id")) {
        throw new Error("SQL must return an activity_id column");
      }
      await connection!.query("DROP TABLE IF EXISTS current_selection");
      await connection!.query(
        `CREATE TEMP TABLE current_selection AS WITH selected AS (${request.sql}) SELECT DISTINCT CAST(a.activity_id AS VARCHAR) activity_id,a.point_count,a.xmin,a.ymin,a.xmax,a.ymax FROM activities a SEMI JOIN selected s USING(activity_id)`,
      );
    }

    const selectedCount = selectionAll
      ? registeredFiles.reduce((total, file) => total + file.rowCount, 0)
      : Number(scalar((await connection!.query("SELECT count(*) total FROM current_selection")).toArray()[0]?.total ?? 0));
    const clean = request.clean && supportsClean;
    const viewport = await render(
      request.lod,
      request.resolution,
      request.bounds,
      clean,
      request.startingVertexEstimate,
    );
    respond(request.id, {
      queryId: String(request.id),
      selectedCount,
      renderPlan: { type: "arrow", activityIds: [] },
      ...viewport,
    });
  } catch (error) {
    self.postMessage({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
