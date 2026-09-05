export type MapState = { longitude: number; latitude: number; zoom: number };
export type Basemap = "streets" | "topo" | "imagery" | "blank";
export type HeatPalette = "sunset" | "viridis" | "fire" | "ice";
export type ThemeMode = "system" | "light" | "dark";
export type UnitSystem = "metric" | "imperial";
export type SystemResolution = "low" | "medium" | "high";
export type MapStyle = {
  color: string;
  lineWidthScale: number;
  basemap: Basemap;
  heatEnabled: boolean;
  heatPalette: HeatPalette;
  heatTemperature: number;
  cleanEnabled: boolean;
};
export type ViewportBounds = [west: number, south: number, east: number, north: number];
export type ViewportSize = { width: number; height: number };
export type SpatialPredicate = "intersects" | "within";
export type SpatialFilter = {
  predicate: SpatialPredicate;
  polygon: [number, number][];
  visible: boolean;
};
export type RenderLod = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type RenderPlanChoice = { lod: RenderLod; vertexEstimate: number };
export type ResolutionRenderPlans = Record<SystemResolution, RenderPlanChoice>;

export type Dataset = { id: string; name: string; manifest: DatasetManifest };
export type DatasetSource =
  | { kind: "directory"; handle: FileSystemDirectoryHandle }
  | { kind: "url"; baseUrl: string; name: string };
export type Activity = { activityId: string; name: string; sportType: string };
export type QueryTab = {
  id: string;
  title: string;
  sql: string;
  mapState: MapState;
  style: MapStyle;
  spatialFilter?: SpatialFilter;
  startingPlans?: ResolutionRenderPlans;
  startingBounds?: ViewportBounds;
};
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
export type RenderPlan = { type: "arrow"; activityIds: string[] };
export type QueryResult = { queryId: string; selectedCount: number; renderPlan: RenderPlan };
export type Share = { id: string; tabId: string; datasetId: string };

export type VertexStats = { sum: number; min: number; max: number };
export type RowGroupManifest = {
  row_count: number;
  bbox: ViewportBounds;
  estimated_uncompressed_bytes?: number;
  vertex_count?: VertexStats;
  clean_vertex_count?: VertexStats;
};
export type DatasetFileManifest = {
  path: string;
  row_count: number;
  byte_size: number;
  sha256: string;
  bbox?: ViewportBounds;
  row_group_count?: number;
  row_groups?: RowGroupManifest[];
};
export type RenderLevelManifest = {
  lod: RenderLod;
  tolerance_m: number | null;
  spatial_layout?: "str";
  row_count: number;
  byte_size: number;
  bbox: ViewportBounds;
  file_count: number;
  row_group_count: number;
  files: DatasetFileManifest[];
};
export type DatasetManifest = {
  schema_version: string;
  activity_count: number;
  rejection_count: number;
  bbox: ViewportBounds;
  metadata?: DatasetFileManifest[];
  shards: DatasetFileManifest[];
  render_levels?: RenderLevelManifest[];
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
  getActivity(activityId: string): Promise<RouteActivity | null>;
}
