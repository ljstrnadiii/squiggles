import { describe, expect, it } from "vitest";

import { padViewportBounds } from "./engine";

describe("padViewportBounds", () => {
  it("pads a normal viewport on every side", () => {
    expect(padViewportBounds([-105, 39, -104, 40], 0.2)).toEqual([-105.2, 38.8, -103.8, 40.2]);
  });

  it("clamps padded bounds to supported world limits", () => {
    expect(padViewportBounds([-179, -84, 179, 84], 0.2)).toEqual([-180, -85, 180, 85]);
  });

  it("does not expand antimeridian-crossing viewports", () => {
    expect(padViewportBounds([170, -10, -170, 10], 0.2)).toEqual([170, -10, -170, 10]);
  });
});
