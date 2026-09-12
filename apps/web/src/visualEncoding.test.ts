import { describe, expect, it } from "vitest";
import type { QueryDimension } from "./contracts";
import { activityVisible, colorForVisualDimension, DEFAULT_VISUAL_ENCODING, reconcileVisualEncoding } from "./visualEncoding";

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

  it("maps categorical values to stable palette colors", () => {
    const sport: QueryDimension = { name: "sport", kind: "categorical", values: { a: "run", b: "ride" }, steps: ["ride", "run"] };
    expect(colorForVisualDimension(sport, "a", "viridis")).not.toEqual(colorForVisualDimension(sport, "b", "viridis"));
  });

  it("drops encodings that are absent from a new query", () => {
    const settings = { ...DEFAULT_VISUAL_ENCODING, animateBy: "month", colorBy: "sport", playing: true };
    expect(reconcileVisualEncoding(settings, [month])).toMatchObject({ animateBy: "month", colorBy: "", playing: true });
    expect(reconcileVisualEncoding(settings, [])).toMatchObject({ animateBy: "", colorBy: "", playing: false });
  });
});
