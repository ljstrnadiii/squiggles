import { normalizeCamera } from "./camera";
import type { Basemap, QueryTab } from "./contracts";

const LEGACY_KEY = "activity-map.tabs.v1";
const SCOPED_KEY = "activity-map.tabs.v2";
export const ELECTRIC_BLUE = "#476bcc";
const legacyDefaultColors = new Set(["#dcff4e", "#ff8a4c", "#315fd5", "#0000ff"]);
const legacyBasemaps: Record<string, Basemap> = {
  "mapbox-standard": "streets",
  "mapbox-satellite": "imagery",
  "mapbox-satellite-clean": "imagery",
  "mapbox-outdoors": "topo",
};
const defaultStyle = { color: ELECTRIC_BLUE, lineWidthScale: 1, basemap: "streets" as const, viewMode: "2d" as const, terrainExaggeration: 2.5, heatEnabled: true, heatPalette: "sunset" as const, heatTemperature: 1.7, cleanEnabled: false };

export const defaultTab: QueryTab = {
  id: "all",
  title: "All Activities",
  sql: "SELECT activity_id FROM activities",
  mapState: { longitude: -105, latitude: 39, zoom: 5, pitch: 0, bearing: 0 },
  style: defaultStyle,
};

export const highRunsTab: QueryTab = {
  ...defaultTab,
  id: "example-high-runs",
  title: "Runs above 12k ft",
  sql: `SELECT activity_id
FROM activities
WHERE lower(sport_type) LIKE '%run%'
  AND max_elevation_m >= 3657.6`,
  style: { ...defaultStyle },
};

export function normalizeRouteColor(color: string) {
  return legacyDefaultColors.has(color.toLowerCase()) ? ELECTRIC_BLUE : color;
}

export function normalizeTab(tab: QueryTab & { style: QueryTab["style"] & { lineWidth?: number } }): QueryTab {
  const legacyScale = tab.style.lineWidth === undefined ? undefined : tab.style.lineWidth / 2;
  const currentStyle = { ...tab.style };
  delete currentStyle.lineWidth;
  const basemap = legacyBasemaps[String(currentStyle.basemap)] ?? currentStyle.basemap;
  const merged = { ...defaultStyle, ...currentStyle, basemap, ...(legacyScale === undefined ? {} : { lineWidthScale: legacyScale }) };
  const style = {
    ...merged,
    lineWidthScale: Math.max(0.25, Math.min(4, merged.lineWidthScale)),
    terrainExaggeration: Math.max(0.25, Math.min(3, Number.isFinite(merged.terrainExaggeration) ? merged.terrainExaggeration : 2.5)),
    viewMode: merged.viewMode === "3d" ? "3d" as const : "2d" as const,
  };
  return {
    ...tab,
    mapState: normalizeCamera(tab.mapState, style.viewMode === "3d" ? 60 : 0),
    style: { ...style, color: normalizeRouteColor(style.color) },
  };
}

function storageKey(scope: string) {
  return `${SCOPED_KEY}:${scope}`;
}

export function mapStorageScope(pathname = window.location.pathname, search = window.location.search) {
  const published = /^\/p\/([a-z0-9]{8})\/?$/.exec(pathname)?.[1];
  if (published) return `published:${published}`;
  const dataset = /^\/m\/([0-9a-f-]{36})\/?$/i.exec(pathname)?.[1];
  if (dataset) return `dataset:${dataset.toLowerCase()}`;
  const local = new URLSearchParams(search).get("dataset");
  return local && /^[a-zA-Z0-9_-]+$/.test(local) ? `local:${local}` : "home";
}

export function loadTabs(scope = "home"): QueryTab[] {
  try {
    const scoped = localStorage.getItem(storageKey(scope));
    const legacy = scope === "home" ? localStorage.getItem(LEGACY_KEY) : null;
    const stored = JSON.parse(scoped ?? legacy ?? "[]") as Array<QueryTab & { style: QueryTab["style"] & { lineWidth?: number } }>;
    if (scope !== "home") return stored.length ? stored.map(normalizeTab) : [defaultTab];
    const tabs = stored.length ? stored.map(normalizeTab) : [defaultTab];
    return tabs.some(tab => tab.id === highRunsTab.id) ? tabs : [...tabs, highRunsTab];
  } catch {
    return [defaultTab, highRunsTab];
  }
}

export function saveTabs(tabs: QueryTab[], scope = "home") {
  localStorage.setItem(storageKey(scope), JSON.stringify(tabs));
}
