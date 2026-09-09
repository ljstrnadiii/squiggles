import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const webRoot = resolve(import.meta.dirname, "..");
const app = readFileSync(join(webRoot, "src/App.tsx"), "utf8");

describe("CARTO basemap wiring", () => {
  it("adds the build-time API key to both CARTO renderers", () => {
    expect(app).toContain("https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png");
    expect(app).toContain("https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png");
    expect(app).toContain("VITE_CARTO_API_KEY");
    const terrain = readFileSync(join(webRoot, "src/MapLibreTerrainRoutes.tsx"), "utf8");
    expect(terrain).toContain("VITE_CARTO_API_KEY");
  });
});
