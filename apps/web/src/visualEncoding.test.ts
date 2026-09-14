import { describe, expect, it } from "vitest";
import type { QueryDimension } from "./contracts";
import { activityVisible, animationFrameLabel, colorForVisualDimension, customPalette, DEFAULT_VISUAL_ENCODING, persistedVisualEncoding, reconcileVisualEncoding, visualEncodingFromPersisted, visualPaletteStops } from "./visualEncoding";

const month: QueryDimension = {
  name: "month",
  kind: "temporal",
  values: { a: "2026-01-01", b: "2026-02-01", c: "2026-03-01" },
  steps: ["2026-01-01", "2026-02-01", "2026-03-01"],
};

describe("query visual encoding", () => {
  it("supports cumulative and windowed visibility", () => {
    const cumulative = { ...DEFAULT_VISUAL_ENCODING, animateBy: "month", animationStep: 1 };
    expect(activityVisible(month, cumulative, "a")).toBe(true);
    expect(activityVisible(month, cumulative, "c")).toBe(false);
    const windowed = { ...cumulative, animationMode: "windowed" as const, windowSize: 1 };
    expect(activityVisible(month, windowed, "a")).toBe(false);
    expect(activityVisible(month, windowed, "b")).toBe(true);
  });

  it("keeps map animation controls opt-in by default and preserves the preference", () => {
    expect(DEFAULT_VISUAL_ENCODING.showMapControls).toBe(false);
    const settings = { ...DEFAULT_VISUAL_ENCODING, animateBy: "month", showMapControls: true };
    expect(reconcileVisualEncoding(settings, [month]).showMapControls).toBe(true);
  });

  it("maps categorical values to stable palette colors", () => {
    const sport: QueryDimension = { name: "sport", kind: "categorical", values: { a: "run", b: "ride" }, steps: ["ride", "run"] };
    expect(colorForVisualDimension(sport, "a", "viridis")).not.toEqual(colorForVisualDimension(sport, "b", "viridis"));
  });

  it("interpolates custom color sequences", () => {
    const category: QueryDimension = {
      name: "category",
      kind: "categorical",
      values: { a: "low", b: "middle", c: "high" },
      steps: ["low", "middle", "high"],
    };
    const palette = customPalette(["#ff0000", "#ffffff", "#0000ff"]);
    expect(visualPaletteStops(palette)).toEqual(["#ff0000", "#ffffff", "#0000ff"]);
    expect(colorForVisualDimension(category, "a", palette)).toEqual([255, 0, 0, 255]);
    expect(colorForVisualDimension(category, "b", palette)).toEqual([255, 255, 255, 255]);
    expect(colorForVisualDimension(category, "c", palette)).toEqual([0, 0, 255, 255]);
  });

  it("persists animation configuration while restarting playback from the first frame", () => {
    const runtime = {
      ...DEFAULT_VISUAL_ENCODING,
      animateBy: "month",
      animationMode: "windowed" as const,
      animationStep: 2,
      windowSize: 3,
      playbackSpeed: 24,
      playing: false,
      loop: false,
      showMapControls: true,
      colorBy: "month",
      palette: customPalette(["#ff0000", "#0000ff"]),
    };
    const persisted = persistedVisualEncoding(runtime);
    expect(persisted).not.toHaveProperty("animationStep");
    expect(persisted).not.toHaveProperty("playing");
    expect(persisted).toMatchObject({ playbackSpeed: 24, showMapControls: true, animationMode: "windowed", windowSize: 3 });
    const restored = visualEncodingFromPersisted(persisted);
    expect(restored).toMatchObject({ playbackSpeed: 24, showMapControls: true, animationStep: 0, playing: true });
    expect(reconcileVisualEncoding(restored, [month])).toMatchObject({ animationStep: 0, playing: true });
  });

  it("keeps the first frame at zero instead of treating it as an unset value", () => {
    const settings = { ...DEFAULT_VISUAL_ENCODING, animateBy: "month", animationStep: 0, playing: true };
    expect(reconcileVisualEncoding(settings, [month])).toMatchObject({ animationStep: 0, playing: true });
    expect(animationFrameLabel(month, 0)).toBe("month = 2026-01-01");
  });

  it("drops encodings that are absent from a new query", () => {
    const settings = { ...DEFAULT_VISUAL_ENCODING, animateBy: "month", colorBy: "sport", playing: true };
    expect(reconcileVisualEncoding(settings, [month])).toMatchObject({ animateBy: "month", colorBy: "", playing: true });
    expect(reconcileVisualEncoding(settings, [])).toMatchObject({ animateBy: "", colorBy: "", playing: false });
  });
});
