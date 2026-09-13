import { describe, expect, it } from "vitest";
import { colorForWeight } from "./heat";
import { customPalette } from "./visualEncoding";

describe("custom heat palette", () => {
  it("uses custom endpoints across the heat domain", () => {
    const palette = customPalette(["#ff0000", "#0000ff"]);
    expect(colorForWeight(0, 10, palette).slice(0, 3)).toEqual([255, 0, 0]);
    expect(colorForWeight(10, 10, palette).slice(0, 3)).toEqual([0, 0, 255]);
  });
});
