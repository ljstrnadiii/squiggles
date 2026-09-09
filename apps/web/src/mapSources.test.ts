import { describe, expect, it } from "vitest";

import { rasterBasemapSources, terrainDemSource } from "./mapSources";

describe("map tile sources", () => {
  it("uses high-density Mapbox satellite and terrain tiles when configured", () => {
    const basemaps = rasterBasemapSources("pk.test token", "carto-key");
    const terrain = terrainDemSource("pk.test token");

    expect(basemaps.imagery).toMatchObject({ tileSize: 512, maxzoom: 22, attribution: expect.stringContaining("Mapbox") });
    expect(basemaps.imagery.tiles[0]).toBe("https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}@2x.jpg90?access_token=pk.test%20token");
    expect(terrain).toMatchObject({ tileSize: 512, maxzoom: 14, encoding: "mapbox", attribution: expect.stringContaining("Mapbox") });
    expect(terrain.tiles[0]).toBe("https://api.mapbox.com/v4/mapbox.terrain-rgb/{z}/{x}/{y}@2x.pngraw?access_token=pk.test%20token");
  });

  it("keeps public fallbacks for local builds without the restricted token", () => {
    const basemaps = rasterBasemapSources(undefined, undefined);
    const terrain = terrainDemSource(undefined);

    expect(basemaps.imagery.tiles[0]).toContain("arcgisonline.com");
    expect(terrain).toMatchObject({ tileSize: 256, encoding: "terrarium" });
    expect(terrain.tiles[0]).toContain("elevation-tiles-prod");
  });
});
