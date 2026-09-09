import type { RenderCacheMetrics, ScanMetrics, ViewportResult } from "./contracts";

export type RenderingDiagnosticState = {
  diagnostics: ViewportResult["diagnostics"];
  lod: number | null;
  vertexCount: number;
  geometryBufferBytes: number;
  plannedVertexEstimate: number;
  rawVertexEstimate: number;
  vertexBudget: number;
  visibleCount: number;
  durationMs: number;
  scan: ScanMetrics;
  cache: RenderCacheMetrics;
  terrain: { loadedSegments: number; submittedSegments: number; tileCount: number };
  selectedRoutes: number;
  mapView: string;
  thickness: string;
  routeWidth: string;
  selectedWidth: string;
  heat: { sourceVertices: number; scores: number; cellCount: number; durationMs: number; slices: number; maxSliceMs: number };
  dataView: string;
  basemap: string;
};

let current: RenderingDiagnosticState | null = null;
const listeners = new Set<(value: RenderingDiagnosticState | null) => void>();

export function recordRenderingDiagnostics(value: RenderingDiagnosticState) {
  current = value;
  listeners.forEach(listener => listener(current));
}

export function renderingDiagnostics() {
  return current;
}

export function subscribeRenderingDiagnostics(listener: (value: RenderingDiagnosticState | null) => void) {
  listeners.add(listener);
  listener(current);
  return () => { listeners.delete(listener); };
}