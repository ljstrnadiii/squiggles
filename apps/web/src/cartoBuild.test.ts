import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const webRoot = resolve(import.meta.dirname, "..");
const sources = readFileSync(join(webRoot, "src/mapSources.ts"), "utf8");

describe("CARTO basemap wiring", () => {
  it("adds the build-time API key to the shared CARTO sources", () => {
    expect(sources).toContain("https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png");
    expect(sources).toContain("https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png");
    expect(sources).toContain("VITE_CARTO_API_KEY");
  });
});
