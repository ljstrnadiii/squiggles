import { describe, expect, it } from "vitest";

import type { BinaryRouteBatch, RouteActivity } from "./contracts";
import { buildBinaryHeatData, buildBinaryHeatDataCooperative, buildHeatData, colorForWeight } from "./heat";

const route = (activityId: string, path: [number, number][]): RouteActivity => ({ activityId, path, fullPath: path, name: activityId, sportType: "Run", startTime: null, distanceM: null, elevationGainM: null, maxElevationM: null, sourceUrl: null, elevationProfile: [] });

describe("buildHeatData", () => {
  it("counts cross-activity vertex pairs without self-heating", () => {
    const result = buildHeatData(
      [route("a", [[-105, 40], [-105, 40]]), route("b", [[-105, 40]])],
      { longitude: -105, latitude: 40, zoom: 12 },
      800,
      600,
      20,
    );
    expect(result.cellCount).toBe(1);
    expect(result.scores.get("a")).toBe(2);
    expect(result.scores.get("b")).toBe(2);
    expect(result.maxScore).toBe(2);
    expect(result.sourceVertices).toBe(3);
  });

  it("scores all chosen vertices without rewriting the route", () => {
    const path: [number, number][] = Array.from({ length: 1000 }, (_, index) => [-105 + index / 1_000_000, 40]);
    const result = buildHeatData([route("a", path), route("b", path)], { longitude: -105, latitude: 40, zoom: 15 }, 800, 600);
    expect(result.sourceVertices).toBe(2000);
    expect(result.scores.size).toBe(2);
    expect(result.scores.get("a")).toBeGreaterThan(0);
  });

  it("uses temperature to saturate repeated corridors sooner", () => {
    const cold = colorForWeight(4, 100, "sunset", 0.7);
    const balanced = colorForWeight(4, 100, "sunset", 1);
    const hot = colorForWeight(4, 100, "sunset", 2.5);
    expect(hot[0]).toBeGreaterThan(balanced[0]);
    expect(balanced[0]).toBeGreaterThan(cold[0]);
    expect(colorForWeight(100, 100, "sunset", 3)).toEqual(colorForWeight(100, 100, "sunset", 0.5));
  });

  it("scores interleaved binary coordinates without making route paths", () => {
    const batch: BinaryRouteBatch = {
      activities: [route("a", []), route("b", [])],
      positions: new Float64Array([-105, 40, -105, 40, -105, 40]),
      startIndices: new Uint32Array([0, 2, 3]),
      segmentActivityIndices: new Uint32Array([0, 1]),
    };
    const result = buildBinaryHeatData([batch], { longitude: -105, latitude: 40, zoom: 12 }, 800, 600, undefined, 20);
    expect(result.sourceVertices).toBe(3);
    expect(result.scores.get("a")).toBe(2);
    expect(result.scores.get("b")).toBe(2);
  });

  it("cooperatively scores the same binary coordinates and yields between slices", async () => {
    const pointsPerRoute = 5000;
    const positions = new Float64Array(pointsPerRoute * 2 * 2);
    for (let point = 0; point < pointsPerRoute * 2; point += 1) {
      positions[point * 2] = -105 + (point % pointsPerRoute) / 1_000_000;
      positions[point * 2 + 1] = 40;
    }
    const batch: BinaryRouteBatch = {
      activities: [route("a", []), route("b", [])],
      positions,
      startIndices: new Uint32Array([0, pointsPerRoute, pointsPerRoute * 2]),
      segmentActivityIndices: new Uint32Array([0, 1]),
    };
    const expected = buildBinaryHeatData([batch], { longitude: -105, latitude: 40, zoom: 12 }, 800, 600);
    const result = await buildBinaryHeatDataCooperative([batch], { longitude: -105, latitude: 40, zoom: 12 }, 800, 600, undefined, 8, () => false, 0);
    expect(result).not.toBeNull();
    expect(result!.scores).toEqual(expected.scores);
    expect(result!.sourceVertices).toBe(expected.sourceVertices);
    expect(result!.yieldCount).toBeGreaterThan(0);
  });
});
