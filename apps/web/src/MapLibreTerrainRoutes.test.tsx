import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const markerCalls = vi.hoisted(() => ({ addTo: vi.fn(), remove: vi.fn(), setLngLat: vi.fn() }));

vi.mock("maplibre-gl", () => ({
  Map: class {
    on(name: string, handler: () => void) { if (name === "load") handler(); return this; }
    off() { return this; }
    getCenter() { return { lng: -105, lat: 40 }; }
    getBounds() { return { getWest: () => -106, getSouth: () => 39, getEast: () => -104, getNorth: () => 41 }; }
    getCanvas() { return { clientWidth: 800, clientHeight: 600, style: { cursor: "" } }; }
    getZoom() { return 12; }
    getPitch() { return 55; }
    getBearing() { return -20; }
    getLayer() { return undefined; }
    addLayer() {}
    jumpTo() {}
    setStyle() {}
    setTerrain() {}
    isStyleLoaded() { return true; }
    remove() {}
  },
  Marker: class {
    setLngLat(position: [number, number]) { markerCalls.setLngLat(position); return this; }
    addTo() { markerCalls.addTo(); return this; }
    remove() { markerCalls.remove(); }
  },
}));

import { MapLibreTerrainRoutes } from "./MapLibreTerrainRoutes";

describe("terrain profile marker", () => {
  it("places a terrain-aware MapLibre marker at the hovered profile position", () => {
    const properties = {
      view: { longitude: -105, latitude: 40, zoom: 12, pitch: 55, bearing: -20 },
      basemap: "blank" as const,
      dark: false,
      exaggeration: 1,
      batches: [],
      colors: [],
      widthPx: 4,
      onView: vi.fn(),
      onInteraction: vi.fn(),
    };
    const result = render(<MapLibreTerrainRoutes {...properties} />);

    result.rerender(<MapLibreTerrainRoutes {...properties} profilePosition={[-105.1, 40.1]} />);

    expect(markerCalls.setLngLat).toHaveBeenLastCalledWith([-105.1, 40.1]);
    expect(markerCalls.addTo).toHaveBeenCalledOnce();
  });
});
