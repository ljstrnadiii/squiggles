import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const engineCalls = vi.hoisted(() => ({
  execute: vi.fn<() => Promise<void> | undefined>(),
  getSummary: vi.fn(),
  mapOptions: vi.fn(),
  maps: [] as Array<{ camera: { center: [number, number]; zoom: number; pitch?: number; bearing?: number }; emit(name: string): void }>,
}));

vi.mock("maplibre-gl", () => ({ Map: class {
  constructor(public camera: { center: [number, number]; zoom: number; pitch?: number; bearing?: number }) { engineCalls.mapOptions(camera); engineCalls.maps.push(this); }
  handlers = new Map<string, ((...args: unknown[]) => void)[]>();
  on(name: string, handler: (...args: unknown[]) => void) { this.handlers.set(name, [...(this.handlers.get(name) ?? []), handler]); if (name === "load") handler(); return this; }
  emit(name: string) { for (const handler of this.handlers.get(name) ?? []) handler(); }
  getCenter() { return { lng: this.camera.center[0], lat: this.camera.center[1] }; }
  getBounds() { return { getWest: () => -107, getSouth: () => 38, getEast: () => -105, getNorth: () => 41 }; }
  getCanvas() { return { clientWidth: 1200, clientHeight: 800, style: { cursor: "" } }; }
  getZoom() { return this.camera.zoom; }
  getPitch() { return this.camera.pitch ?? 0; }
  getBearing() { return this.camera.bearing ?? 0; }
  getLayer() { return undefined; }
  addLayer() {}
  jumpTo(camera: { center: [number, number]; zoom: number }) { this.camera = camera; }
  setStyle() {}
  setTerrain() {}
  isStyleLoaded() { return true; }
  off(name: string, handler: (...args: unknown[]) => void) { this.handlers.set(name, (this.handlers.get(name) ?? []).filter(item => item !== handler)); return this; }
  remove() {}
} }));
vi.mock("./engine", () => ({
  BrowserDuckDBEngine: class {
    setResolution() {}
    async openDataset(source: { name?: string }) {
      return { id: source.name ?? "synthetic", name: source.name ?? "synthetic", manifest: { schema_version: "1.0.0", activity_count: 1, rejection_count: 0, bbox: [-105, 39, -104, 40], shards: [] } };
    }
    async execute() {
      await engineCalls.execute();
      return { queryId: "1", selectedCount: 1, lod: 1, vertexCount: 2, geometryBufferBytes: 32, activityCount: 1, plannedVertexEstimate: 2, rawVertexEstimate: 2, vertexBudget: 1000, cache: { hit: false, bytes: 48, budgetBytes: 1024, entries: 1, evictions: 0 }, scan: { candidateFragmentCount: 1, totalFragmentCount: 2, candidateBytes: 1024, totalBytes: 4096, expectedRowGroupCount: 1, candidateRowGroupCount: 2, totalRowGroupCount: 4, expectedRowCount: 3, keptRowCount: 1 }, summary: { activityCount: 1, distanceM: 5000, elapsedSeconds: 2100, movingSeconds: 1800, elevationGainM: 100, elevationLossM: 90, minElevationM: 1400, maxElevationM: 1600, maxDistanceM: 5000, activeDays: 1, droppedJumpPoints: 1, droppedElevationPoints: 2, sportCounts: [{ sport: "ride", count: 1 }], firstActivity: "2025-01-01", lastActivity: "2025-01-01" }, renderPlan: { type: "arrow", activityIds: ["synthetic-1"] }, batches: [{ activities: [{ activityId: "synthetic-1", name: "Synthetic route", sportType: "Ride", startTime: "2025-01-01", distanceM: 5000, elevationGainM: 100, maxElevationM: 1600, sourceUrl: null }], positions: new Float64Array([-105, 39, -104, 40]), startIndices: new Uint32Array([0, 2]), segmentActivityIndices: new Uint32Array([0]) }] };
    }
    async renderViewport() { return { lod: 1, vertexCount: 0, geometryBufferBytes: 0, activityCount: 0, plannedVertexEstimate: 0, rawVertexEstimate: 0, vertexBudget: 1000, cache: { hit: false, bytes: 48, budgetBytes: 1024, entries: 1, evictions: 0 }, scan: { candidateFragmentCount: 1, totalFragmentCount: 2, candidateBytes: 1024, totalBytes: 4096, expectedRowGroupCount: 1, candidateRowGroupCount: 2, totalRowGroupCount: 4, expectedRowCount: 3, keptRowCount: 0 }, batches: [] }; }
    async getSummary() { engineCalls.getSummary(); return { activityCount: 1, distanceM: 5000, elapsedSeconds: 2100, movingSeconds: 1800, elevationGainM: 100, elevationLossM: 90, minElevationM: 1400, maxElevationM: 1600, maxDistanceM: 5000, activeDays: 1, droppedJumpPoints: 1, droppedElevationPoints: 2, sportCounts: [{ sport: "ride", count: 1 }], firstActivity: "2025-01-01", lastActivity: "2025-01-01" }; }
    async getActivities() { return [{ activityId: "synthetic-1", name: "Synthetic route", sportType: "Ride", startTime: "2025-01-01", distanceM: 5000, elevationGainM: 100, maxElevationM: 1600, sourceUrl: null, bounds: [-105, 39, -104, 40] }]; }
    async getRouteMetadata() { return { activityId: "synthetic-1", name: "Synthetic route", sportType: "Ride", startTime: "2025-01-01", distanceM: 5000, elevationGainM: 100, maxElevationM: 1600, sourceUrl: null }; }
    async getActivity() { return { activityId: "synthetic-1", name: "Synthetic route", sportType: "Ride", startTime: "2025-01-01", distanceM: 5000, elevationGainM: 100, maxElevationM: 1600, sourceUrl: null, path: [[-105, 39], [-104, 40]], fullPath: [[-105, 39], [-104, 40]], elevationProfile: [{ distanceM: 0, elevationM: 1400, position: [-105, 39] }, { distanceM: 5000, elevationM: 1600, position: [-104, 40] }] }; }
  },
}));

afterEach(() => { cleanup(); localStorage.clear(); engineCalls.execute.mockReset(); engineCalls.getSummary.mockClear(); engineCalls.mapOptions.mockClear(); engineCalls.maps.length = 0; });
import { App } from "./App";

describe("App", () => {
  function openQueryMenu() { fireEvent.click(screen.getByRole("button", { name: "Open query menu" })); }
  function openLogoMenu() { fireEvent.click(screen.getByRole("button", { name: "Open Squiggles menu" })); }
  function openQuerySettings() { openQueryMenu(); fireEvent.click(screen.getByRole("button", { name: "Query settings" })); }

  it("renders the product name", async () => {
    window.history.replaceState({}, "", "/");
    render(<App />);
    expect(screen.getByRole("img", { name: "Squiggles" })).toBeInTheDocument();
    expect(screen.queryByText("Every route. One map.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Squiggles menu" })).toHaveAttribute("data-tooltip", "Squiggles menu");
    expect(screen.getByRole("button", { name: "Log in" })).toHaveClass("login-button");
    openLogoMenu();
    fireEvent.click(screen.getByRole("button", { name: "About" }));
    expect(screen.getByRole("region", { name: "About this project" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Squiggles on GitHub" })).toHaveAttribute("href", "https://github.com/ljstrnadiii/squiggles");
    fireEvent.click(screen.getByRole("button", { name: "Close about this project" }));
    expect(screen.queryByRole("textbox", { name: "SQL query" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Toggle query toolbar" })).not.toBeInTheDocument();
    openLogoMenu();
    fireEvent.click(screen.getByRole("button", { name: "System settings" }));
    expect(screen.getByRole("region", { name: "System settings" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use imperial units" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Use system theme" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Medium" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "High" }));
    expect(screen.getByRole("button", { name: "High" })).toHaveAttribute("aria-pressed", "true");
    expect(localStorage.getItem("activity-map.resolution.v1")).toBe("high");
    fireEvent.click(screen.getByRole("button", { name: "Use light theme" }));
    expect(screen.getByRole("button", { name: "Use light theme" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("img", { name: "Squiggles" })).toHaveAttribute("src", "/logo-light.png");
    fireEvent.click(screen.getByRole("button", { name: "Close system settings" }));
    openQuerySettings();
    expect(screen.getByRole("combobox", { name: "Basemap" })).toHaveValue("streets");
    expect(screen.getByRole("option", { name: "Imagery" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use 2D map view" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Use 3D map view" }));
    expect(screen.getByRole("button", { name: "Use 3D map view" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("combobox", { name: "Heat colormap" })).toHaveValue("sunset");
    expect(screen.getByLabelText("Route color")).toHaveValue("#476bcc");
    const temperature = screen.getByRole("slider", { name: "Heat temperature" });
    expect(temperature).toHaveValue("1.7");
    fireEvent.change(temperature, { target: { value: "2.4" } });
    expect(temperature).toHaveValue("2.4");
    const starter = await screen.findByRole("combobox", { name: "SQL starter query" });
    fireEvent.change(starter, { target: { value: "rides" } });
    openQueryMenu();
    expect(screen.getByRole("button", { name: "Rendering" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Runs above 12k ft" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "AI Skills" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close query menu" }));
    const editor = await screen.findByRole("textbox", { name: "SQL query" });
    await waitFor(() => expect(editor).toHaveTextContent("activity_family = 'ride'"));
    expect(screen.getByRole("checkbox", { name: "Clean" }).closest("label")).toHaveAttribute("data-tooltip", expect.stringContaining("GPS jumps"));
  });

  it("opens a directly linked local tab with query controls closed", () => {
    window.history.replaceState({}, "", "/?tab=example-high-runs&color=%23dcff4e");
    render(<App />);
    openQueryMenu();
    expect(screen.getByRole("button", { name: "Runs above 12k ft" })).toHaveClass("active");
    fireEvent.click(screen.getByRole("button", { name: "Close query menu" }));
    expect(screen.queryByRole("textbox", { name: "SQL query" })).not.toBeInTheDocument();
    openQuerySettings();
    expect(screen.getByLabelText("Route color")).toHaveValue("#476bcc");
  });

  it("offers shared query and system navigation without a hamburger", () => {
    window.history.replaceState({}, "", "/");
    render(<App />);
    expect(screen.queryByRole("button", { name: "Open navigation menu" })).not.toBeInTheDocument();
    openLogoMenu();
    expect(screen.getByRole("navigation", { name: "Squiggles navigation" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "System settings" }));
    expect(screen.getByRole("region", { name: "System settings" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Query navigation" })).not.toBeInTheDocument();
  });

  it("opens an unlisted hosted dataset from its share route", async () => {
    const datasetId = "31ea1577-b6f1-423a-8bda-ea7712345678";
    window.history.replaceState({}, "", `/m/${datasetId}`);
    render(<App />);
    expect(await screen.findByRole("status", { name: "1 routes selected" })).toBeInTheDocument();
    openLogoMenu();
    expect(screen.getByRole("button", { name: "Change dataset" })).toBeInTheDocument();
    expect(screen.queryByText(datasetId)).not.toBeInTheDocument();
  });

  it("opens a synthetic developer dataset and renders its summary", async () => {
    window.history.replaceState({}, "", "/?dataset=synthetic");
    render(<App />);
    expect(await screen.findByRole("status", { name: "1 routes selected" })).toBeInTheDocument();
    expect(engineCalls.getSummary).not.toHaveBeenCalled();
    openQueryMenu();
    fireEvent.click(screen.getByRole("button", { name: "Rendering" }));
    expect(screen.getByRole("region", { name: "Rendering diagnostics" })).toBeInTheDocument();
    expect(screen.queryByRole("slider", { name: "Panel size" })).not.toBeInTheDocument();
    expect(screen.getByText("LOD 1 · simplified overview")).toBeInTheDocument();
    expect(screen.getByText("Fragments read")).toBeInTheDocument();
    expect(screen.getByText("Row groups expected read")).toBeInTheDocument();
    expect(screen.getByText("GeoArrow buffers")).toBeInTheDocument();
    expect(screen.getByText("Coordinate objects created")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close rendering diagnostics" }));
    expect(screen.queryByRole("region", { name: "Selection summary" })).not.toBeInTheDocument();
    expect(screen.queryByText("3 mi")).not.toBeInTheDocument();
    openQueryMenu();
    fireEvent.click(screen.getByRole("button", { name: "Statistics" }));
    await waitFor(() => expect(engineCalls.getSummary).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("region", { name: "Detailed selection statistics" })).toBeInTheDocument();
    expect(screen.queryByRole("slider", { name: "Panel size" })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Limit to activities contained in viewport" })).not.toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: "Limit to activities contained in viewport" }));
    await waitFor(() => expect(screen.getByText("CONTAINED IN VIEWPORT")).toBeInTheDocument());
    expect(screen.getAllByText("3 mi")).toHaveLength(3);
    expect(screen.getByText((_, node) => node?.tagName === "SPAN" && node.textContent === "1 ride")).toBeInTheDocument();
    openQuerySettings();
    expect(screen.getByRole("checkbox", { name: "Clean" })).not.toBeChecked();
    expect(engineCalls.execute).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("checkbox", { name: "Clean" }));
    await waitFor(() => expect(engineCalls.execute).toHaveBeenCalledTimes(2));
    openQueryMenu();
    await waitFor(() => expect(screen.getByRole("button", { name: "Table" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Table" }));
    expect(await screen.findByRole("region", { name: "Activity table" })).toBeInTheDocument();
    expect(screen.queryByRole("slider", { name: "Panel size" })).not.toBeInTheDocument();
    expect(await screen.findByText("Synthetic route")).toBeInTheDocument();
    const activityRow = screen.getByText("Synthetic route").closest("tr")!;
    fireEvent.mouseEnter(activityRow);
    expect(activityRow).toHaveClass("selected");
    expect(document.querySelector(".tooltip")).not.toBeInTheDocument();
    fireEvent.mouseLeave(activityRow);
    expect(activityRow).not.toHaveClass("selected");
    fireEvent.click(screen.getByRole("button", { name: "Sort by Activity" }));
    expect(screen.getByRole("columnheader", { name: "Activity" })).toHaveAttribute("aria-sort", "ascending");
    fireEvent.click(screen.getByText("Synthetic route"));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Activity table" })).not.toBeInTheDocument());
    await waitFor(() => expect(new URL(window.location.href).searchParams.get("lng")).toBe("-104.50000"));
    expect(screen.getByRole("heading", { name: "Synthetic route" })).toBeInTheDocument();
    const isolate = screen.getByRole("button", { name: "Show only this route" });
    fireEvent.click(isolate);
    expect(screen.getByRole("button", { name: "Show all routes" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("img", { name: "Elevation profile chart" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zoom to route" })).toBeInTheDocument();
    expect(screen.getByText("3 mi")).toBeInTheDocument();
    await waitFor(() => expect(new URL(window.location.href).searchParams.get("units")).toBe("imperial"));
    openQueryMenu();
    fireEvent.click(screen.getByRole("button", { name: "Rendering" }));
    expect(screen.queryByRole("complementary", { name: "Activity detail" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Rendering diagnostics" })).toBeInTheDocument();
  });

  it("restores map settings from the URL and keeps changes shareable", async () => {
    window.history.replaceState({}, "", "/?tab=all&lng=-106.25&lat=39.5&zoom=9.25&bearing=31.5&pitch=47.0&basemap=carto-dark&view=3d&heat=0&palette=ice&temperature=2.4&thickness=1.6&clean=1&color=%23abcdef&units=imperial");
    render(<App />);
    openLogoMenu();
    fireEvent.click(screen.getByRole("button", { name: "System settings" }));
    expect(screen.getByRole("button", { name: "Use imperial units" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Close system settings" }));
    openQuerySettings();
    expect(screen.getByRole("combobox", { name: "Basemap" })).toHaveValue("carto-dark");
    expect(screen.getByRole("button", { name: "Use 3D map view" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("checkbox", { name: "Clean" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Heat" })).not.toBeChecked();
    expect(screen.getByRole("slider", { name: "Heat temperature" })).toHaveValue("2.4");
    expect(screen.getByRole("slider", { name: "Route thickness" })).toHaveValue("1.6");
    fireEvent.change(screen.getByRole("combobox", { name: "Basemap" }), { target: { value: "topo" } });
    await waitFor(() => expect(new URL(window.location.href).searchParams.get("basemap")).toBe("topo"));
    expect(new URL(window.location.href).searchParams.get("view")).toBe("3d");
    expect(engineCalls.mapOptions).toHaveBeenLastCalledWith(expect.objectContaining({ pitch: 47, bearing: 31.5 }));
    expect(new URL(window.location.href).searchParams.get("lng")).toBe("-106.25000");
  });

  it("creates a query tab at the current camera instead of the default location", async () => {
    window.history.replaceState({}, "", "/?tab=all&lng=-106.25&lat=39.5&zoom=11.25&bearing=-22.0&pitch=43.5&basemap=carto-dark&view=3d");
    render(<App />);
    openQueryMenu();
    fireEvent.click(screen.getByRole("button", { name: "New query" }));
    expect(screen.getByRole("button", { name: "Open query menu" })).toHaveTextContent("New Query");
    await waitFor(() => expect(new URL(window.location.href).searchParams.get("lng")).toBe("-106.25000"));
    expect(new URL(window.location.href).searchParams.get("zoom")).toBe("11.25");
    const stored = JSON.parse(localStorage.getItem("activity-map.tabs.v1") ?? "[]") as { title: string; mapState: { longitude: number; latitude: number; zoom: number }; style: { basemap: string; viewMode: string } }[];
    expect(stored.find(item => item.title === "New Query")).toMatchObject({ mapState: { longitude: -106.25, latitude: 39.5, zoom: 11.25 }, style: { basemap: "carto-dark", viewMode: "3d" } });
  });

  it("keeps a camera move made while a query is running", async () => {
    window.history.replaceState({}, "", "/?dataset=synthetic&tab=all&lng=-106.25&lat=39.5&zoom=11.25&pitch=43.5&bearing=-22&view=3d");
    render(<App />);
    expect(await screen.findByRole("status", { name: "1 routes selected" })).toBeInTheDocument();

    let finishQuery!: () => void;
    engineCalls.execute.mockImplementationOnce(() => new Promise<void>(resolve => { finishQuery = resolve; }));
    openQuerySettings();
    fireEvent.click(screen.getByRole("checkbox", { name: "Clean" }));
    await waitFor(() => expect(engineCalls.execute).toHaveBeenCalledTimes(2));

    const map = engineCalls.maps[0];
    map.camera = { center: [-110.5, 42.25], zoom: 9.75, pitch: 58, bearing: 17 };
    map.emit("moveend");
    finishQuery();

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem("activity-map.tabs.v1") ?? "[]") as Array<{ id: string; mapState: { longitude: number; latitude: number; zoom: number; pitch: number; bearing: number } }>;
      expect(stored.find(item => item.id === "all")?.mapState).toEqual({ longitude: -110.5, latitude: 42.25, zoom: 9.75, pitch: 58, bearing: 17 });
    });
  });
});
