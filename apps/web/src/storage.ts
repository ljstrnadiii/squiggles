import type { QueryTab } from "./contracts";

const KEY = "activity-map.tabs.v1";
export const ELECTRIC_BLUE = "#476bcc";
const legacyDefaultColors = new Set(["#dcff4e", "#ff8a4c", "#315fd5", "#0000ff"]);
const defaultStyle = { color: ELECTRIC_BLUE, lineWidthScale: 1, basemap: "streets" as const, heatEnabled: true, heatPalette: "sunset" as const, heatTemperature: 1.7, cleanEnabled: false };

export const defaultTab: QueryTab = {
  id: "all",
  title: "All Activities",
  sql: "SELECT activity_id FROM activities",
  mapState: { longitude: -105, latitude: 39, zoom: 5 },
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
      const merged = { ...defaultStyle, ...currentStyle, ...(legacyScale === undefined ? {} : { lineWidthScale: legacyScale }) };
      const style = { ...merged, lineWidthScale: Math.max(0.25, Math.min(4, merged.lineWidthScale)) };
      const normalized = { ...tab, style: { ...style, color: normalizeRouteColor(style.color) } };
      return normalized.id === highRunsTab.id
        ? { ...normalized, title: highRunsTab.title, sql: highRunsTab.sql }
        : normalized;
    }) : [defaultTab];
    return tabs.some(tab => tab.id === highRunsTab.id) ? tabs : [...tabs, highRunsTab];
  } catch {
    return [defaultTab, highRunsTab];
  }
}

export function saveTabs(tabs: QueryTab[]) {
  localStorage.setItem(KEY, JSON.stringify(tabs));
}
