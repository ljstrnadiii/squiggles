import { describe, expect, it } from "vitest";

import { binaryPathData, pickedActivity, routeColors } from "./binaryRoutes";
import type { BinaryRouteBatch } from "./contracts";

const batch: BinaryRouteBatch = {
  activities: [
    { activityId: "a", name: "A", sportType: "Run", startTime: null, distanceM: null, elevationGainM: null, maxElevationM: null, sourceUrl: null },
    { activityId: "b", name: "B", sportType: "Ride", startTime: null, distanceM: null, elevationGainM: null, maxElevationM: null, sourceUrl: null },
  ],
  positions: new Float64Array([-105, 40, -104, 41, -103, 42]),
  startIndices: new Uint32Array([0, 2, 3]),
  segmentActivityIndices: new Uint32Array([0, 1]),
};

describe("GeoArrow binary route data", () => {
  it("passes the coordinate buffer directly to deck.gl", () => {
    const data = binaryPathData(batch);
    expect(data.attributes.getPath.value).toBe(batch.positions);
    expect(data.attributes.getPath.value?.buffer).toBe(batch.positions.buffer);
    expect(data.startIndices).toBe(batch.startIndices);
    expect(data.length).toBe(2);
  });

  it("maps binary segment picks and colors back to route metadata", () => {
    expect(pickedActivity(batch, 1)?.activityId).toBe("b");
    expect(pickedActivity(batch, -1)).toBeNull();
    expect(routeColors(batch, activity => activity.activityId === "a" ? [1, 2, 3, 4] : [5, 6, 7, 8])).toEqual(new Uint8Array([1, 2, 3, 4, 1, 2, 3, 4, 5, 6, 7, 8]));
  });
});
