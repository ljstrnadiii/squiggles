import type { HeatPalette, QueryDimension } from "./contracts";
import { colorForWeight } from "./heat";

export type AnimationMode = "cumulative" | "windowed";
export type VisualEncodingSettings = {
  animateBy: string;
  animationMode: AnimationMode;
  animationStep: number;
  windowSize: number;
  playbackSpeed: number;
  playing: boolean;
  loop: boolean;
  colorBy: string;
  palette: HeatPalette;
};

export const DEFAULT_VISUAL_ENCODING: VisualEncodingSettings = {
  animateBy: "",
  animationMode: "cumulative",
  animationStep: 0,
  windowSize: 1,
  playbackSpeed: 2,
  playing: false,
  loop: true,
  colorBy: "",
  palette: "viridis",
};

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
  palette: HeatPalette,
): [number, number, number, number] | null {
  if (!dimension) return null;
  const value = dimension.values[activityId];
  if (value == null) return null;
  if (dimension.kind === "numeric" && typeof value === "number" && dimension.domain) {
    const [minimum, maximum] = dimension.domain;
    return colorForWeight(Math.max(0, value - minimum), Math.max(0, maximum - minimum), palette, 1);
  }
  const index = dimension.steps.findIndex(step => step === value);
  return index < 0 ? null : colorForWeight(index, Math.max(1, dimension.steps.length - 1), palette, 1);
}
