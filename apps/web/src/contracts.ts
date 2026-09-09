export type Units = "metric" | "imperial";
export type Basemap = "carto-light" | "carto-dark" | "streets" | "topo" | "imagery" | "blank";
export type HeatPalette = "sunset" | "viridis" | "fire" | "ice";
export type SystemResolution = "low" | "medium" | "high";
export type RenderLod = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type MapState = {
  longitude: number;
  latitude: number;
  zoom: number;
  pitch: number;
  bearing: number;
};
export type QueryTab = {
  id: string;
  title: string;
  sql: string;
  mapState: MapState;
  style: {
    basemap: Basemap;
    viewMode: "2d" | "3d";
    terrainExaggeration: number;
    routeWidth: number;
    selectedRouteWidth: number;
    heatEnabled: boolean;
    heatPalette: HeatPalette;
    heatIntensity: number;
    cleanGeometry: boolean;
  };
  startingPlans?: ResolutionRenderPlans;
};
export type DatasetFileManifest = {
  path: string;
  byte_size: number;
  row_count: number;
  bbox?: ViewportBounds;
  row_groups?: {
    row_count: number;
    bbox: ViewportBounds;
    vertex_count?: { sum: number };
    clean_vertex_count?: { sum: number };
  }[];
};
export type DatasetManifest = {
  schema_version: string;
  activity_count: number;
  rejection_count: number;
  bbox?: ViewportBounds;
  shards: DatasetFileManifest[];
  metadata?: DatasetFileManifest[];
  render_levels?: { lod: RenderLod; files: DatasetFileManifest[] }[];
};
export type DatasetSource =
  | { kind: "directory"; handle: FileSystemDirectoryHandle }
  | { kind: "url"; name: string; baseUrl: string };
export type Dataset = { id: string; name: string; manifest: DatasetManifest };
export type ViewportBounds = [number, number, number, number];
export type ViewportSize = {
  width: number;
  height: number;
  pixelMeters?: number;
  threeD?: boolean;
};
export type ResolutionRenderPlan = { lod: RenderLod; vertexEstimate: number };
export type ResolutionRenderPlans = Record<SystemResolution, ResolutionRenderPlan>;
export type QueryResult = { selectionCount: number };
export type SummaryStats = {
  activityCount: number;
  distanceM: number;
  elapsedSeconds: number;
  movingSeconds: number;
  elevationGainM: number;
  elevationLossM: number;
  minElevationM: number | null;
  maxElevationM: number | null;
  maxDistanceM: number | null;
  activeDays: number;
  droppedJumpPoints: number;
  droppedElevationPoints: number;
  sportCounts: { sport: string; count: number }[];
  firstActivity: string | null;
  lastActivity: string | null;
};
export type ElevationSample = {
  distanceM: number;
  elevationM: number;
  position: [number, number];
};
export type RouteMetadata = {
  activityId: string;
  name: string;
  sportType: string;
  startTime: string | null;
  distanceM: number | null;
  elevationGainM: number | null;
  maxElevationM: number | null;
  sourceUrl: string | null;
};
export type RouteActivity = RouteMetadata & {
  path: [number, number][];
  fullPath: [number, number][];
  elevationProfile: ElevationSample[];
};
export type ActivityListItem = RouteMetadata & {
  bounds: [number, number, number, number];
};
/**
 * A record-batch-sized GeoArrow LineString view. Positions remain in the
 * interleaved Arrow coordinate buffer; only the small segment indices are new.
 */
export type BinaryRouteBatch = {
  activities: RouteMetadata[];
  positions: Float64Array;
  startIndices: Uint32Array;
  segmentActivityIndices: Uint32Array;
};
export type ScanMetrics = {
  candidateFragmentCount: number;
  totalFragmentCount: number;
  candidateBytes: number;
  totalBytes: number;
  expectedRowGroupCount: number;
  candidateRowGroupCount: number;
  totalRowGroupCount: number;
  expectedRowCount: number;
  keptRowCount: number;
};
export type RenderCacheMetrics = {
  hit: boolean;
  bytes: number;
  budgetBytes: number;
  entries: number;
  evictions: number;
};
export type ViewportResult = {
  diagnostics?: { requestedLod: RenderLod; candidateRoutes: number };
  batches: BinaryRouteBatch[];
  activityCount: number;
  geometryBufferBytes: number;
  lod: RenderLod;
  vertexCount: number;
  plannedVertexEstimate: number;
  resolutionPlans: ResolutionRenderPlans;
  rawVertexEstimate: number;
  vertexBudget: number;
  scan: ScanMetrics;
  cache: RenderCacheMetrics;
};
export interface ExecutionEngine {
  setResolution(resolution: SystemResolution): void;
  setRenderSettings(settings: import("./renderSettings").RenderSettings): void;
  openDataset(
    source: DatasetSource,
    onProgress?: (completed: number, total: number) => void,
  ): Promise<Dataset>;
  execute(
    tab: QueryTab,
    zoom: number,
    bounds?: ViewportBounds,
    viewportSize?: ViewportSize,
  ): Promise<QueryResult & ViewportResult>;
  renderViewport(
    zoom: number,
    bounds: ViewportBounds,
    viewportSize?: ViewportSize,
  ): Promise<ViewportResult>;
  getSummary(bounds?: ViewportBounds): Promise<SummaryStats>;
  getActivities(bounds?: ViewportBounds): Promise<ActivityListItem[]>;
  getRouteMetadata(activityId: string): Promise<RouteMetadata | null>;
  getActivity(activityId: string): Promise<RouteActivity | null>;
}
