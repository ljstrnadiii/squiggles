import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const markerCalls = vi.hoisted(() => ({ addTo: vi.fn(), remove: vi.fn(), setLngLat: vi.fn() }));
const mapCalls = vi.hoisted(() => ({ jumpTo: vi.fn(), setStyle: vi.fn() }));

vi.mock("maplibre-gl", () => ({
  Map: class {
    on(name: string, handler: () => void) { if (name === "load") handler(); return this; }
    off() { return this; }
    getSource() { return undefined; }
    unproject(point: [number, number]) { return { lng: -105 + point[0] / 10000, lat: 40 - point[1] / 10000 }; }
    getCenter() { return { lng: -105, lat: 40 }; }
    getBounds() { return { getWest: () => -106, getSouth: () => 39, getEast: () => -104, getNorth: () => 41 }; }
    getCanvas() { return { clientWidth: 800, clientHeight: 600, style: { cursor: "" } }; }
    getZoom() { return 12; }
    getPitch() { return 55; }
    getBearing() { return -20; }
    getLayer() { return undefined; }
    addLayer() {}
    jumpTo(options: unknown) { mapCalls.jumpTo(options); }
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

import { MapLibreTerrainRoutes, terrainSegmentBatch } from "./MapLibreTerrainRoutes";
import type { BinaryRouteBatch } from "./contracts";

afterEach(() => {
  markerCalls.addTo.mockClear(); markerCalls.remove.mockClear(); markerCalls.setLngLat.mockClear(); mapCalls.jumpTo.mockClear(); mapCalls.setStyle.mockClear();
});

describe("terrain profile marker", () => {
  it("submits the highlighted route after other routes without changing its color", () => {
    const batch: BinaryRouteBatch = {
      activities: [
        { activityId: "background", name: "Background", sportType: "Run", startTime: null, distanceM: null, elevationGainM: null, maxElevationM: null, sourceUrl: null },
        { activityId: "highlight", name: "Highlight", sportType: "Run", startTime: null, distanceM: null, elevationGainM: null, maxElevationM: null, sourceUrl: null },
      ],
      positions: new Float64Array([-105, 40, -104, 41, -105, 40, -104, 41]),
      startIndices: new Uint32Array([0, 2, 4]),
      segmentActivityIndices: new Uint32Array([0, 1]),
    };
    const colors = new Uint8Array([
      10, 20, 30, 255, 10, 20, 30, 255,
      40, 50, 60, 255, 40, 50, 60, 255,
    ]);
    const result = terrainSegmentBatch([batch], [colors], undefined, "highlight");
    expect([...result.owners]).toEqual([0, 1]);
    expect([...result.colors.slice(4, 8)]).toEqual([40, 50, 60, 255]);
    expect(result.widths?.[0]).toBeCloseTo(1);
    expect(result.widths?.[1]).toBeCloseTo(1.8);
  });

  it("uses an explicit configured color for the highlighted route", () => {
    const batch: BinaryRouteBatch = {
      activities: [
        { activityId: "background", name: "Background", sportType: "Run", startTime: null, distanceM: null, elevationGainM: null, maxElevationM: null, sourceUrl: null },
        { activityId: "highlight", name: "Highlight", sportType: "Run", startTime: null, distanceM: null, elevationGainM: null, maxElevationM: null, sourceUrl: null },
      ],
      positions: new Float64Array([-105, 40, -104, 41, -105, 40, -104, 41]),
      startIndices: new Uint32Array([0, 2, 4]),
      segmentActivityIndices: new Uint32Array([0, 1]),
    };
    const heatColors = new Uint8Array([
      10, 20, 30, 255, 10, 20, 30, 255,
      220, 80, 20, 255, 220, 80, 20, 255,
    ]);
    const configured = new Uint8Array([71, 107, 204, 255]);
    const result = terrainSegmentBatch([batch], [heatColors], undefined, "highlight", undefined, configured);
    expect([...result.colors.slice(0, 4)]).toEqual([10, 20, 30, 255]);
    expect([...result.colors.slice(4, 8)]).toEqual([71, 107, 204, 255]);
    expect(result.widths?.[1]).toBeCloseTo(1.8);
  });

  it("submits a highlighted route after routes from later binary batches", () => {
    const highlighted: BinaryRouteBatch = {
      activities: [{ activityId: "highlight", name: "Highlight", sportType: "Run", startTime: null, distanceM: null, elevationGainM: null, maxElevationM: null, sourceUrl: null }],
      positions: new Float64Array([-105, 40, -104, 41]),
      startIndices: new Uint32Array([0, 2]),
      segmentActivityIndices: new Uint32Array([0]),
    };
    const background: BinaryRouteBatch = {
      activities: [{ activityId: "background", name: "Background", sportType: "Run", startTime: null, distanceM: null, elevationGainM: null, maxElevationM: null, sourceUrl: null }],
      positions: new Float64Array([-105, 40, -104, 41]),
      startIndices: new Uint32Array([0, 2]),
      segmentActivityIndices: new Uint32Array([0]),
    };
    const result = terrainSegmentBatch(
      [highlighted, background],
      [new Uint8Array([40, 50, 60, 255, 40, 50, 60, 255]), new Uint8Array([10, 20, 30, 255, 10, 20, 30, 255])],
      undefined,
      "highlight",
    );
    expect([...result.owners]).toEqual([1, 0]);
    expect([...result.colors.slice(4, 8)]).toEqual([40, 50, 60, 255]);
    expect(result.widths?.[0]).toBeCloseTo(1);
    expect(result.widths?.[1]).toBeCloseTo(1.8);
  });

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

  it("applies external 3d camera fits without flattening pitch or bearing", () => {
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

    result.rerender(<MapLibreTerrainRoutes {...properties} view={{ longitude: -105.25, latitude: 39.75, zoom: 14, pitch: 55, bearing: -20 }} />);

    expect(mapCalls.jumpTo).toHaveBeenLastCalledWith({ center: [-105.25, 39.75], zoom: 14, pitch: 55, bearing: -20 });
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