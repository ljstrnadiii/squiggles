import { describe, expect, it } from "vitest";

import { chooseLod, RESOLUTION_VERTEX_BUDGETS } from "./lod";

describe("chooseLod", () => {
  it("keeps zoom as a fidelity ceiling even when finer detail fits", () => {
    expect(chooseLod([3200, 8000, 32000, 146044, 900000], 1, RESOLUTION_VERTEX_BUDGETS.low)).toBe(1);
  });

  it("uses a balanced level for the full export", () => {
    expect(chooseLod([126494, 317136, 1259440, 5708384, 13255105], 0, RESOLUTION_VERTEX_BUDGETS.medium)).toBe(0);
  });

  it("falls back to the lowest available level when every estimate exceeds budget", () => {
    expect(chooseLod([6000000, 15000000, 60000000, 250000000, 500000000], 0, RESOLUTION_VERTEX_BUDGETS.high)).toBe(0);
  });

  it("uses full geometry at close zoom when it fits the viewport budget", () => {
    expect(chooseLod([100, 250, 1000, 5000, 24000], 4, RESOLUTION_VERTEX_BUDGETS.low)).toBe(4);
    expect(chooseLod([100, 250, 1000, 5000, 24000], 3, RESOLUTION_VERTEX_BUDGETS.low)).toBe(3);
  });

  it("does not read raw geometry for an over-budget dense close view", () => {
    expect(chooseLod([51400, 128500, 514000, 2200000, 4761806], 4, RESOLUTION_VERTEX_BUDGETS.low)).toBe(1);
    expect(chooseLod([51400, 128500, 514000, 2200000, 4761806], 4, RESOLUTION_VERTEX_BUDGETS.medium)).toBe(2);
    expect(chooseLod([98000, 247100, 988400, 4440000, 8700000], 4, RESOLUTION_VERTEX_BUDGETS.medium)).toBe(1);
    expect(chooseLod([98000, 247100, 988400, 4440000, 8700000], 4, RESOLUTION_VERTEX_BUDGETS.high)).toBe(2);
  });
});
