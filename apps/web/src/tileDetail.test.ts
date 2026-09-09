import { describe, expect, it, vi } from "vitest";
import type { Map, Source } from "maplibre-gl";
import { applyTileDetail } from "./tileDetail";
describe("independent tile detail", () => {
  it("biases the chosen source without accumulating across updates", () => {
    const terrain = {} as Source, imagery = {} as Source;
    let moving = false;
    const map = {
      getSource: (id: string) => id === "terrain" ? terrain : imagery,
      setSourceTileLodParams: (_levels: number, _ratio: number, id: string) => { (id === "terrain" ? terrain : imagery).calculateTileZoom = zoom => zoom - 2; },
      isMoving: () => moving,
      triggerRepaint: vi.fn(),
    } as unknown as Map;
    applyTileDetail(map, "terrain", 2);
    applyTileDetail(map, "basemap", 0.5);
    const args = [12, 1, 1, 1, 40] as const;
    expect(terrain.calculateTileZoom!(...args)).toBe(12);
    expect(imagery.calculateTileZoom!(...args)).toBe(10.5);
    moving = true;
    expect(terrain.calculateTileZoom!(...args)).toBe(11);
    expect(imagery.calculateTileZoom!(...args)).toBe(10.5);
    moving = false;
    applyTileDetail(map, "terrain", 1);
    expect(terrain.calculateTileZoom!(...args)).toBe(11);
    applyTileDetail(map, "terrain", 0);
    expect(terrain.calculateTileZoom!(...args)).toBe(10);
  });
});
