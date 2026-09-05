import { describe, expect, it } from "vitest";

import {
  chooseLod,
  lodForView,
  metersPerPixel,
  RESOLUTION_VERTEX_BUDGETS,
} from "./lod";

describe("screen-space LOD fidelity", () => {
  it("uses Web Mercator ground resolution at the camera latitude", () => {
    expect(metersPerPixel(12, 40)).toBeCloseTo(14.64, 1);
    expect(metersPerPixel(12, 60)).toBeLessThan(metersPerPixel(12, 40));
  });

  it("chooses the coarsest tolerance below one rendered pixel", () => {
    expect(lodForView(4, 40)).toBe(0);
    expect(lodForView(6, 40)).toBe(1);
    expect(lodForView(8, 40)).toBe(2);
    expect(lodForView(10, 40)).toBe(3);
    expect(lodForView(12, 40)).toBe(4);
    expect(lodForView(14, 40)).toBe(5);
    expect(lodForView(16, 40)).toBe(6);
    expect(lodForView(18, 40)).toBe(7);
  });
});

describe("resolution budgets", () => {
  it("changes only the vertex budget", () => {
    expect(RESOLUTION_VERTEX_BUDGETS).toEqual({
      low: 750_000,
      medium: 1_250_000,
      high: 1_750_000,
    });
  });
});

describe("chooseLod", () => {
  const estimates = [
    20_000,
    50_000,
    120_000,
    300_000,
    700_000,
    1_600_000,
    3_500_000,
    8_000_000,
  ];

  it("keeps screen-space fidelity as a ceiling even when finer detail fits", () => {
    expect(chooseLod(estimates, 2, RESOLUTION_VERTEX_BUDGETS.high)).toBe(2);
  });

  it("falls back one level at a time until the budget fits", () => {
    expect(chooseLod(estimates, 7, RESOLUTION_VERTEX_BUDGETS.low)).toBe(4);
    expect(chooseLod(estimates, 7, RESOLUTION_VERTEX_BUDGETS.medium)).toBe(4);
    expect(chooseLod(estimates, 7, RESOLUTION_VERTEX_BUDGETS.high)).toBe(5);
  });

  it("keeps requested detail when it fits", () => {
    expect(chooseLod(estimates, 4, RESOLUTION_VERTEX_BUDGETS.low)).toBe(4);
  });
});
