import { describe, expect, it } from "vitest";

import { chooseLod, lodForZoom, RESOLUTION_VERTEX_BUDGETS } from "./lod";

describe("lodForZoom", () => {
  it("advances one tolerance level every two zooms", () => {
    expect(lodForZoom(6, "medium")).toBe(0);
    expect(lodForZoom(8, "medium")).toBe(1);
    expect(lodForZoom(10, "medium")).toBe(2);
    expect(lodForZoom(12, "medium")).toBe(3);
    expect(lodForZoom(14, "medium")).toBe(4);
    expect(lodForZoom(16, "medium")).toBe(5);
    expect(lodForZoom(18, "medium")).toBe(6);
    expect(lodForZoom(20, "medium")).toBe(7);
  });

  it("shifts low and high by one lod", () => {
    expect(lodForZoom(12, "low")).toBe(2);
    expect(lodForZoom(12, "medium")).toBe(3);
    expect(lodForZoom(12, "high")).toBe(4);
    expect(lodForZoom(2, "low")).toBe(0);
    expect(lodForZoom(22, "high")).toBe(7);
  });
});

describe("chooseLod", () => {
  const estimates = [20_000, 50_000, 120_000, 300_000, 700_000, 1_600_000, 3_500_000, 8_000_000];

  it("keeps zoom as a fidelity ceiling even when finer detail fits", () => {
    expect(chooseLod(estimates, 2, RESOLUTION_VERTEX_BUDGETS.high)).toBe(2);
  });

  it("falls back one level at a time until the budget fits", () => {
    expect(chooseLod(estimates, 7, RESOLUTION_VERTEX_BUDGETS.low)).toBe(2);
    expect(chooseLod(estimates, 7, RESOLUTION_VERTEX_BUDGETS.medium)).toBe(4);
    expect(chooseLod(estimates, 7, RESOLUTION_VERTEX_BUDGETS.high)).toBe(4);
  });

  it("keeps requested detail when it fits", () => {
    expect(chooseLod(estimates, 4, RESOLUTION_VERTEX_BUDGETS.medium)).toBe(4);
  });
});
