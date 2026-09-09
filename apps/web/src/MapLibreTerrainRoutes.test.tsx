import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const markerCalls = vi.hoisted(() => ({ addTo: vi.fn(), remove: vi.fn(), setLngLat: vi.fn() }));
const mapCalls = vi.hoisted(() => ({ setStyle: vi.fn() }));

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
    setStyle(style: unknown) { mapCalls.setStyle(style); }
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

afterEach(() => {
  markerCalls.addTo.mockClear(); markerCalls.remove.mockClear(); markerCalls.setLngLat.mockClear(); mapCalls.setStyle.mockClear();
});

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

  it("does not rebuild the identical terrain style immediately after map creation", () => {
    const properties = {
      view: { longitude: -105, latitude: 40, zoom: 12, pitch: 55, bearing: -20 },
      basemap: "imagery" as const,
      dark: false,
      exaggeration: 1,
      batches: [],
      colors: [],
      widthPx: 4,
      onView: vi.fn(),
      onInteraction: vi.fn(),
    };
    const result = render(<MapLibreTerrainRoutes {...properties} />);

    expect(mapCalls.setStyle).not.toHaveBeenCalled();
    result.rerender(<MapLibreTerrainRoutes {...properties} dark />);
    expect(mapCalls.setStyle).toHaveBeenCalledOnce();
  });
});
