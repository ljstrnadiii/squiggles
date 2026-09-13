import type { HeatPalette, QueryDimension } from "./contracts";
import { colorForWeight } from "./heat";

export type AnimationMode = "cumulative" | "windowed";
export type VisualPalette = HeatPalette | `custom:${string}`;
export type VisualEncodingSettings = {
  animateBy: string;
  animationMode: AnimationMode;
  animationStep: number;
  windowSize: number;
  playbackSpeed: number;
  playing: boolean;
  loop: boolean;
  showMapControls: boolean;
  colorBy: string;
  palette: VisualPalette;
};

export const DEFAULT_CUSTOM_COLOR_STOPS = ["#440154", "#21918c", "#fde725"];

export const DEFAULT_VISUAL_ENCODING: VisualEncodingSettings = {
  animateBy: "",
  animationMode: "cumulative",
  animationStep: 0,
  windowSize: 1,
  playbackSpeed: 2,
  playing: false,
  loop: true,
  showMapControls: false,
  colorBy: "",
  palette: "viridis",
};

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

type Color = [number, number, number, number];

function normalizedHexColor(color: string) {
  return HEX_COLOR.test(color) ? color.toLowerCase() : null;
}

function hexToColor(color: string): Color | null {
  const normalized = normalizedHexColor(color);
  if (!normalized) return null;
  return [
    Number.parseInt(normalized.slice(1, 3), 16),
    Number.parseInt(normalized.slice(3, 5), 16),
    Number.parseInt(normalized.slice(5, 7), 16),
    255,
  ];
}

export function customPalette(colors: string[]): VisualPalette {
  const stops = colors.map(normalizedHexColor).filter((color): color is string => Boolean(color));
  const safeStops = stops.length >= 2 ? stops : DEFAULT_CUSTOM_COLOR_STOPS;
  return `custom:${safeStops.join(",")}`;
}

export function visualPaletteStops(palette: VisualPalette): string[] {
  if (!palette.startsWith("custom:")) return [];
  const stops = palette.slice("custom:".length).split(",").map(normalizedHexColor).filter((color): color is string => Boolean(color));
  return stops.length >= 2 ? stops : DEFAULT_CUSTOM_COLOR_STOPS;
}

function colorForCustomPosition(position: number, colors: string[]): Color | null {
  const stops = colors.map(hexToColor).filter((color): color is Color => Boolean(color));
  if (stops.length < 2) return null;
  const clamped = Math.max(0, Math.min(1, position));
  const scaled = clamped * (stops.length - 1);
  const lower = Math.floor(scaled);
  const upper = Math.min(stops.length - 1, lower + 1);
  const ratio = scaled - lower;
  return stops[lower].map((value, index) => Math.round(value + (stops[upper][index] - value) * ratio)) as Color;
}

export function dimensionByName(dimensions: QueryDimension[], name: string) {
  return dimensions.find(dimension => dimension.name === name);
}

export function reconcileVisualEncoding(
  settings: VisualEncodingSettings,
  dimensions: QueryDimension[],
): VisualEncodingSettings {
  const animation = dimensionByName(dimensions, settings.animateBy);
  const color = dimensionByName(dimensions, settings.colorBy);
  const animationStep = animation
    ? Math.max(0, Math.min(animation.steps.length - 1, settings.animationStep || animation.steps.length - 1))
    : 0;
  return {
    ...settings,
    animateBy: animation ? settings.animateBy : "",
    animationStep,
    playing: animation ? settings.playing : false,
    colorBy: color ? settings.colorBy : "",
  };
}

export function activityVisible(
  dimension: QueryDimension | undefined,
  settings: VisualEncodingSettings,
  activityId: string,
) {
  if (!dimension || !settings.animateBy || !dimension.steps.length) return true;
  const value = dimension.values[activityId];
  if (value == null) return false;
  const index = dimension.steps.findIndex(step => step === value);
  if (index < 0) return false;
  const current = Math.max(0, Math.min(dimension.steps.length - 1, settings.animationStep));
  if (settings.animationMode === "cumulative") return index <= current;
  return index <= current && index >= Math.max(0, current - settings.windowSize + 1);
}

export function colorForVisualDimension(
  dimension: QueryDimension | undefined,
  activityId: string,
  palette: VisualPalette,
): Color | null {
  if (!dimension) return null;
  const value = dimension.values[activityId];
  if (value == null) return null;

  const customStops = visualPaletteStops(palette);
  if (customStops.length >= 2) {
    if (dimension.kind === "numeric" && typeof value === "number" && dimension.domain) {
      const [minimum, maximum] = dimension.domain;
      const position = maximum === minimum ? 0 : (value - minimum) / (maximum - minimum);
      return colorForCustomPosition(position, customStops);
    }
    const index = dimension.steps.findIndex(step => step === value);
    return index < 0 ? null : colorForCustomPosition(index / Math.max(1, dimension.steps.length - 1), customStops);
  }

  const preset = palette as HeatPalette;
  if (dimension.kind === "numeric" && typeof value === "number" && dimension.domain) {
    const [minimum, maximum] = dimension.domain;
    return colorForWeight(Math.max(0, value - minimum), Math.max(0, maximum - minimum), preset, 1);
  }
  const index = dimension.steps.findIndex(step => step === value);
  return index < 0 ? null : colorForWeight(index, Math.max(1, dimension.steps.length - 1), preset, 1);
}
