import type { Basemap, QueryTab } from "./contracts";

const KEY = "activity-map.tabs.v1";
export const ELECTRIC_BLUE = "#476bcc";
const legacyDefaultColors = new Set(["#dcff4e", "#ff8a4c", "#315fd5", "#0000ff"]);
const defaultBasemapOptions = { labels: false, roads: false, trails: false, boundaries: false, objects3d: false };
const defaultStyle = { color: ELECTRIC_BLUE, lineWidthScale: 1, basemap: "mapbox-standard" as const, basemapOptions: defaultBasemapOptions, viewMode: "2d" as const, heatEnabled: true, heatPalette: "sunset" as const, heatTemperature: 1.7, cleanEnabled: false };
const legacyBasemaps: Record<string, Basemap> = {
  streets: "mapbox-standard",
  topo: "mapbox-outdoors",
  imagery: "mapbox-satellite",
  "mapbox-satellite-clean": "mapbox-satellite",
};

export const defaultTab: QueryTab = {
  id: "all",
  title: "All Activities",
  sql: "SELECT activity_id FROM activities",
  mapState: { longitude: -105, latitude: 39, zoom: 5, bearing: 0, pitch: 0 },
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

export function loadTabs(): QueryTab[] {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "[]") as Array<QueryTab & { style: QueryTab["style"] & { lineWidth?: number } }>;
    const tabs = stored.length ? stored.map(tab => {
      const legacyScale = tab.style.lineWidth === undefined ? undefined : tab.style.lineWidth / 2;
      const currentStyle = { ...tab.style };
      delete currentStyle.lineWidth;
      const migratedBasemap = legacyBasemaps[currentStyle.basemap] ?? currentStyle.basemap;
      const merged = { ...defaultStyle, ...currentStyle, basemap: migratedBasemap, basemapOptions: { ...defaultBasemapOptions, ...currentStyle.basemapOptions }, ...(legacyScale === undefined ? {} : { lineWidthScale: legacyScale }) };
      const style = { ...merged, lineWidthScale: Math.max(0.25, Math.min(4, merged.lineWidthScale)) };
      const mapState = {
        ...tab.mapState,
        bearing: Number.isFinite(tab.mapState?.bearing) ? tab.mapState.bearing : 0,
        pitch: Number.isFinite(tab.mapState?.pitch) ? tab.mapState.pitch : 0,
      };
      return { ...tab, mapState, style: { ...style, color: normalizeRouteColor(style.color) } };
    }) : [defaultTab];
    return tabs.some(tab => tab.id === highRunsTab.id) ? tabs : [...tabs, highRunsTab];
  } catch {
    return [defaultTab, highRunsTab];
  }
}

export function saveTabs(tabs: QueryTab[]) {
  localStorage.setItem(KEY, JSON.stringify(tabs));
}
