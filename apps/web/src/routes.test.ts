import { describe, expect, it } from "vitest";

import { lineWidthsForViewport, splitDiscontinuities } from "./routes";

describe("splitDiscontinuities", () => {
  it("keeps ordinary route legs together", () => {
    expect(splitDiscontinuities([[-105, 39], [-105.01, 39.01], [-105.02, 39.02]])).toHaveLength(1);
  });

  it("does not draw across implausibly large gaps", () => {
    expect(splitDiscontinuities([[-105, 39], [-105.01, 39.01], [-80, 35], [-80.01, 35.01]])).toEqual([
      [[-105, 39], [-105.01, 39.01]],
      [[-80, 35], [-80.01, 35.01]],
    ]);
  });
});

describe("lineWidthsForViewport", () => {
  it("uses a stable fraction of the shorter viewport dimension", () => {
    const desktop = lineWidthsForViewport(1, 1440, 900);
    const mobile = lineWidthsForViewport(1, 390, 844);
    expect(desktop.route).toBeCloseTo(1.35);
    expect(mobile.route).toBeCloseTo(0.585);
    expect(desktop.heat).toBe(desktop.route);
  });

  it("applies the user factor linearly", () => {
    expect(lineWidthsForViewport(2, 1440, 900).route).toBeCloseTo(2.7);
  });
});
