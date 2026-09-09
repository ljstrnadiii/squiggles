import { describe, expect, it } from "vitest";

import {
  lodForMetersPerPixel,
  lodForView,
  metersPerPixel,
  MIN_THREE_D_VERTEX_BUDGETS,
  MIN_VERTEX_BUDGETS,
  RESOLUTION_VERTEX_BUDGETS,
  scheduledVertexBudget,
  THREE_D_VERTEX_BUDGETS,
} from "./lod";

describe("screen-space LOD fidelity", () => {
  it("measures Web Mercator meters per CSS pixel without latitude scaling", () => {
    expect(metersPerPixel(12)).toBeCloseTo(19.11, 1);
    expect(metersPerPixel(12)).toBe(metersPerPixel(12));
  });

  it("accepts a perspective-sampled effective resolution", () => {
    expect(lodForMetersPerPixel(7)).toBe(5);
    expect(lodForMetersPerPixel(1.5)).toBe(6);
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

describe("zoom scheduled vertex budgets", () => {
  it("uses smaller budgets when zoomed out and reaches the configured ceiling up close", () => {
    expect(MIN_VERTEX_BUDGETS).toEqual({ low: 100_000, medium: 200_000, high: 300_000 });
    expect(RESOLUTION_VERTEX_BUDGETS).toEqual({ low: 500_000, medium: 750_000, high: 1_000_000 });
    expect(scheduledVertexBudget("medium", 6)).toBe(200_000);
    expect(scheduledVertexBudget("medium", 10)).toBe(500_000);
    expect(scheduledVertexBudget("medium", 14)).toBe(750_000);
  });

  it("keeps 3D on a more conservative schedule", () => {
    expect(MIN_THREE_D_VERTEX_BUDGETS).toEqual({ low: 75_000, medium: 125_000, high: 200_000 });
    expect(THREE_D_VERTEX_BUDGETS).toEqual({ low: 325_000, medium: 500_000, high: 650_000 });
    expect(scheduledVertexBudget("medium", 6, true)).toBe(150_000);
    expect(scheduledVertexBudget("medium", 10, true)).toBe(300_000);
    expect(scheduledVertexBudget("medium", 14, true)).toBe(500_000);
  });

  it("quantizes budgets so tiny zoom changes do not trigger replans", () => {
    expect(scheduledVertexBudget("high", 10)).toBe(scheduledVertexBudget("high", 10.1));
  });
});
