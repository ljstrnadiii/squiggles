import { describe, expect, it } from "vitest";
import { perspectivePixelMeters } from "./perspectiveResolution";
const circumference = 2 * Math.PI * 6_378_137;
const position = (x: number, y: number) => ({ lng: x / circumference * 360, lat: Math.atan(Math.sinh(y / circumference * 2 * Math.PI)) * 180 / Math.PI });
describe("perspective route fidelity", () => {
  it("uses the most magnified direction, independent of bearing", () => {
    expect(perspectivePixelMeters(1000, 800, ([x, y]) => position(3 * x - 4 * y, 4 * x + 3 * y))).toBeCloseTo(5);
    expect(perspectivePixelMeters(1000, 800, ([x, y]) => position(2 * x, 20 * y))).toBeCloseTo(2);
  });
  it("keeps foreground scale when the upper view extends toward the horizon", () => {
    expect(perspectivePixelMeters(1000, 800, ([x, y]) => position(x * (1000 / y), 1_000_000 / y))).toBeLessThan(2);
  });
  it("rejects degenerate projections so the caller can use camera zoom", () => {
    expect(perspectivePixelMeters(1000, 800, () => ({ lng: NaN, lat: NaN }))).toBe(Infinity);
  });
});
