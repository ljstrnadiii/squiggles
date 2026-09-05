import { describe, expect, it } from "vitest";

import {
  chooseLod,
  lodForView,
  lodForViewport,
  metersPerPixel,
  metersPerPixelForViewport,
  RESOLUTION_VERTEX_BUDGETS,
} from "./lod";

describe("screen-space LOD fidelity", () => {
  it("measures Web Mercator meters per CSS pixel without latitude scaling", () => {
    expect(metersPerPixel(12)).toBeCloseTo(19.11, 1);
    expect(metersPerPixel(12)).toBe(metersPerPixel(12));
  });

  it("derives the same resolution from projected viewport extent and CSS pixels", () => {
    const bounds: [number, number, number, number] = [-105.5, 39.9, -105.1, 40.2];
    const width = 1024;
    const height = 768;
    const resolution = metersPerPixelForViewport(bounds, width, height);
    expect(resolution).toBeGreaterThan(0);
    expect(lodForViewport(bounds, width, height)).toBeGreaterThanOrEqual(0);
  });

  it("chooses the coarsest tolerance below one rendered pixel", () => {
    expect(lodForView(4)).toBe(0);
    expect(lodForView(6)).toBe(1);
    expect(lodForView(8)).toBe(2);
    expect(lodForView(10)).toBe(3);
    expect(lodForView(12)).toBe(4);
    expect(lodForView(14)).toBe(5);
    expect(lodForView(16)).toBe(6);
    expect(lodForView(18)).toBe(7);
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
