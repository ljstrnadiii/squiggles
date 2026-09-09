import { describe, expect, it } from "vitest";

import {
  lodForMetersPerPixel,
  lodForView,
  metersPerPixel,
  RESOLUTION_VERTEX_BUDGETS,
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

describe("3D resolution budgets", () => {
  it("keeps terrain and imagery rendering within smaller GPU budgets", () => {
    expect(THREE_D_VERTEX_BUDGETS).toEqual({ low: 100_000, medium: 250_000, high: 750_000 });
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
