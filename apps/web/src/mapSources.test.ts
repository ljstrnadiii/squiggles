import { describe, expect, it } from "vitest";

import { rasterBasemapSources, terrainDemSource } from "./mapSources";

describe("map tile sources", () => {
  it("uses high-density Mapbox satellite and Mapterhorn terrain tiles", () => {
    const basemaps = rasterBasemapSources("pk.test token", "carto-key");
    const terrain = terrainDemSource();

    expect(basemaps.imagery).toMatchObject({ tileSize: 512, maxzoom: 22, attribution: expect.stringContaining("Mapbox") });
    expect(basemaps.imagery.tiles[0]).toBe("https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}@2x.jpg90?access_token=pk.test%20token");
    expect(terrain).toEqual({ type: "raster-dem", url: "https://tiles.mapterhorn.com/tilejson.json" });
  });

  it("keeps a public imagery fallback for local builds without the restricted token", () => {
    const basemaps = rasterBasemapSources(undefined, undefined);

    expect(basemaps.imagery.tiles[0]).toContain("arcgisonline.com");
  });
});
