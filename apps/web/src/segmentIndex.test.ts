import { describe, expect, it } from "vitest";
import { SegmentIndex } from "./segmentIndex";
describe("terrain segment visibility", () => {
  it("retains crossings with both endpoints outside and excludes distant geometry", () => {
    const index = new SegmentIndex(new Float32Array([-1, 0.5, 2, 0.5, 2, 2, 3, 3, 0.2, 0.2, 0.8, 0.8]));
    expect(index.query([0, 0, 1, 1])).toEqual([0, 2]);
  });
  it("keeps horizon tile routes regardless of distance from camera center", () => {
    const index = new SegmentIndex(new Float32Array([0.1, 0.1, 0.2, 0.2, 0.8, 0.8, 0.9, 0.9]));
    expect(index.query([0.75, 0.75, 1, 1])).toEqual([1]);
  });
  it("matches a brute-force bbox scan across split nodes", () => {
    const endpoints = Float32Array.from({ length: 4000 }, (_, i) => ((i * 7919) % 997) / 997);
    const bounds = [0.2, 0.3, 0.4, 0.6] as const;
    const expected = [];
    for (let i = 0; i < endpoints.length; i += 4) {
      if (Math.min(endpoints[i], endpoints[i + 2]) <= bounds[2] && Math.max(endpoints[i], endpoints[i + 2]) >= bounds[0] && Math.min(endpoints[i + 1], endpoints[i + 3]) <= bounds[3] && Math.max(endpoints[i + 1], endpoints[i + 3]) >= bounds[1]) expected.push(i / 4);
    }
    expect(new SegmentIndex(endpoints).query(bounds)).toEqual(expected);
  });
});
