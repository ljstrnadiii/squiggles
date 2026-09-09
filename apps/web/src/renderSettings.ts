export type RenderSettings = {
  fillBudget: boolean;
  pixelError: number;
  lodBias: number;
  vertexBudget: number | null;
  imageryDetail: number;
  terrainDetail: number;
};

export const DEFAULT_RENDER_SETTINGS: RenderSettings = {
  fillBudget: true,
  pixelError: 1,
  lodBias: 0,
  vertexBudget: null,
  imageryDetail: 2,
  terrainDetail: 2,
};
const KEY = "activity-map.render-settings.v1";
const clamp = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;

export function normalizeRenderSettings(value: Partial<RenderSettings>): RenderSettings {
  return {
    fillBudget: typeof value.fillBudget === "boolean" ? value.fillBudget : true,
    pixelError: clamp(value.pixelError, 1, 0.25, 2),
    lodBias: Math.round(clamp(value.lodBias, 0, -1, 1)),
    vertexBudget: value.vertexBudget == null ? null : Math.round(clamp(value.vertexBudget, 1_250_000, 50_000, 3_000_000)),
    imageryDetail: clamp(value.imageryDetail, 2, 0, 2),
    terrainDetail: clamp(value.terrainDetail, 2, 0, 2),
  };
}
export function loadRenderSettings(): RenderSettings {
  try { return normalizeRenderSettings(JSON.parse(localStorage.getItem(KEY) ?? "{}") ?? {}); }
  catch { return { ...DEFAULT_RENDER_SETTINGS }; }
}
export function saveRenderSettings(settings: RenderSettings) {
  localStorage.setItem(KEY, JSON.stringify(settings));
}
