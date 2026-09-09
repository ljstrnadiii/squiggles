import { describe, expect, it } from "vitest";
import { heatSamplingPlan } from "./heatSamplingPlan";

describe("heatSamplingPlan", () => {
  it("keeps visible bounds distinct from padded fetch bounds", () => {
    const visible: [number, number, number, number] = [-105.3, 39.9, -105.1, 40.1];
    const fetch: [number, number, number, number] = [-105.34, 39.86, -105.06, 40.14];
    expect(heatSamplingPlan(visible, fetch)).toEqual({ visibleBounds: visible, fetchBounds: fetch });
  });
});
