import { WebMercatorViewport, type PickingInfo } from "@deck.gl/core";
import { PathLayer, ScatterplotLayer } from "@deck.gl/layers";
import DeckGL from "@deck.gl/react";
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";

import type { ActivityListItem, Basemap, BinaryRouteBatch, DatasetSource, ElevationSample, HeatPalette, MapState, QueryTab, RenderCacheMetrics, RouteActivity, RouteMetadata, ScanMetrics, SpatialPredicate, SummaryStats, SystemResolution, ThemeMode, UnitSystem, ViewportBounds } from "./contracts";
import { binaryPathData, pickedActivity, routeColors } from "./binaryRoutes";
import { BrowserDuckDBEngine } from "./engine";
import { buildBinaryHeatDataCooperative, colorForWeight, type CooperativeHeatResult } from "./heat";
import { QUERY_SCHEMA } from "./querySchema";
import { lineWidthsForViewport, routeSegments, type RouteSegment } from "./routes";
import { spatialLayers } from "./spatialLayers";
import { defaultTab, ELECTRIC_BLUE, loadTabs, normalizeRouteColor, saveTabs } from "./storage";
import { loadTheme, saveTheme } from "./theme";
import { distanceUnit, distanceValue, elevationUnit, elevationValue, loadUnits, saveUnits } from "./units";
import { AccountPanel } from "./AccountPanel";
import { clearSession, identityFromSession, loadSession } from "./auth";
import { loadRuntimeConfig } from "./auth";
import { loadPublishedView, publishView } from "./publishing";
import { loadSystemResolution, saveSystemResolution } from "./resolution";

const blankStyle: maplibregl.StyleSpecification = { version: 8, sources: {}, layers: [{ id: "background", type: "background", paint: { "background-color": "#07100e" } }] };
const rasterStyles: Record<Exclude<Basemap, "blank">, { tiles: string[]; attribution: string; maxzoom: number }> = {
  streets: { tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], attribution: "© OpenStreetMap contributors", maxzoom: 19 },
  topo: { tiles: ["https://tile.opentopomap.org/{z}/{x}/{y}.png"], attribution: "Map data © OpenStreetMap contributors, SRTM | Map style © OpenTopoMap (CC-BY-SA)", maxzoom: 17 },
  imagery: { tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"], attribution: "Sources: Esri, Maxar, Earthstar Geographics, and the GIS User Community", maxzoom: 19 },
};
const empty: SummaryStats = { activityCount: 0, distanceM: 0, elapsedSeconds: 0, movingSeconds: 0, elevationGainM: 0, elevationLossM: 0, minElevationM: null, maxElevationM: null, maxDistanceM: null, activeDays: 0, droppedJumpPoints: 0, droppedElevationPoints: 0, sportCounts: [], firstActivity: null, lastActivity: null };
const integer = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const emptyScan: ScanMetrics = { candidateFragmentCount: 0, totalFragmentCount: 0, candidateBytes: 0, totalBytes: 0, expectedRowGroupCount: 0, candidateRowGroupCount: 0, totalRowGroupCount: 0, expectedRowCount: 0, keptRowCount: 0 };
const emptyCache: RenderCacheMetrics = { hit: false, bytes: 0, budgetBytes: 0, entries: 0, evictions: 0 };
const emptyHeat: CooperativeHeatResult = { scores: new Map(), sourceVertices: 0, cellCount: 0, maxScore: 0, durationMs: 0, yieldCount: 0, maxSliceMs: 0 };
const bytes = (value: number) => value < 1024 ? `${value} B` : value < 1024 ** 2 ? `${(value / 1024).toFixed(1)} KiB` : value < 1024 ** 3 ? `${(value / 1024 ** 2).toFixed(1)} MiB` : `${(value / 1024 ** 3).toFixed(2)} GiB`;
const percent = (part: number, total: number) => total > 0 ? `${(part / total * 100).toFixed(1)}%` : "—";
const SqlEditor = lazy(() => import("./SqlEditor").then(module => ({ default: module.SqlEditor })));
const basemaps = new Set<Basemap>(["streets", "topo", "imagery", "blank"]);
const heatPalettes = new Set<HeatPalette>(["sunset", "viridis", "fire", "ice"]);
function finiteParameter(parameters: URLSearchParams, name: string, minimum: number, maximum: number) {
  const raw = parameters.get(name);
  if (raw === null || raw.trim() === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value >= minimum && value <= maximum ? value : undefined;
}

function tabsWithUrlSettings(tabs: QueryTab[]) {
  const parameters = new URLSearchParams(window.location.search);
  const requested = parameters.get("tab");
  const target = tabs.find(item => item.id === requested) ?? tabs[0];
  const longitude = finiteParameter(parameters, "lng", -180, 180);
  const latitude = finiteParameter(parameters, "lat", -85, 85);
  const zoom = finiteParameter(parameters, "zoom", 0, 24);
  const basemap = parameters.get("basemap");
  const palette = parameters.get("palette");
  const temperature = finiteParameter(parameters, "temperature", 0.5, 3);
  const thickness = finiteParameter(parameters, "thickness", 0.25, 4);
  const color = parameters.get("color");
  const next: QueryTab = {
    ...target,
    mapState: longitude === undefined || latitude === undefined || zoom === undefined ? target.mapState : { longitude, latitude, zoom },
    style: {
      ...target.style,
      ...(basemap && basemaps.has(basemap as Basemap) ? { basemap: basemap as Basemap } : {}),
      ...(palette && heatPalettes.has(palette as HeatPalette) ? { heatPalette: palette as HeatPalette } : {}),
      ...(temperature === undefined ? {} : { heatTemperature: temperature }),
      ...(thickness === undefined ? {} : { lineWidthScale: thickness }),
      ...(parameters.get("heat") === "1" ? { heatEnabled: true } : parameters.get("heat") === "0" ? { heatEnabled: false } : {}),
      ...(parameters.get("clean") === "1" ? { cleanEnabled: true } : parameters.get("clean") === "0" ? { cleanEnabled: false } : {}),
      ...(color && /^#[0-9a-f]{6}$/i.test(color) ? { color: normalizeRouteColor(color) } : {}),
    },
  };
  return tabs.map(item => item.id === next.id ? next : item);
}

function hasUrlCamera() {
  const parameters = new URLSearchParams(window.location.search);
  return finiteParameter(parameters, "lng", -180, 180) !== undefined
    && finiteParameter(parameters, "lat", -85, 85) !== undefined
    && finiteParameter(parameters, "zoom", 0, 24) !== undefined;
}

function sharedDatasetId(pathname = window.location.pathname) {
  const match = /^\/m\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/?$/i.exec(pathname);
  return match?.[1];
}

function publishedSlug(pathname = window.location.pathname) {
  return /^\/p\/([a-z0-9]{8})\/?$/.exec(pathname)?.[1];
}

function replaceUrlSettings(tab: QueryTab, view: MapState, units: UnitSystem) {
  const url = new URL(window.location.href);
  url.searchParams.set("tab", tab.id);
  url.searchParams.set("lng", view.longitude.toFixed(5));
  url.searchParams.set("lat", view.latitude.toFixed(5));
  url.searchParams.set("zoom", view.zoom.toFixed(2));
  url.searchParams.set("basemap", tab.style.basemap);
  url.searchParams.set("heat", tab.style.heatEnabled ? "1" : "0");
  url.searchParams.set("palette", tab.style.heatPalette);
  url.searchParams.set("temperature", tab.style.heatTemperature.toFixed(1));
  url.searchParams.set("thickness", tab.style.lineWidthScale.toFixed(1));
  url.searchParams.set("clean", tab.style.cleanEnabled ? "1" : "0");
  url.searchParams.set("color", tab.style.color);
  url.searchParams.set("units", units);
  window.history.replaceState({}, "", url);
}

type ViewportInsets = { top: number; right: number; bottom: number; left: number };

function viewportInsets(element: HTMLElement | null): ViewportInsets {
  const none = { top: 0, right: 0, bottom: 0, left: 0 };
  if (!element) return none;
  const panel = document.querySelector<HTMLElement>(".detail, .rich-stats, .activity-table, .toolbar");
  if (!panel) return none;
  const map = element.getBoundingClientRect();
  const drawer = panel.getBoundingClientRect();
  if (map.width <= 0 || map.height <= 0 || drawer.width <= 0 || drawer.height <= 0) return none;
  const overlapWidth = Math.max(0, Math.min(map.right, drawer.right) - Math.max(map.left, drawer.left));
  const overlapHeight = Math.max(0, Math.min(map.bottom, drawer.bottom) - Math.max(map.top, drawer.top));
  if (overlapWidth === 0 || overlapHeight === 0) return none;
  return drawer.width >= map.width * 0.8
    ? { ...none, bottom: overlapHeight }
    : { ...none, right: overlapWidth };
}

function fitBounds([xmin, ymin, xmax, ymax]: [number, number, number, number], maximumZoom = 12, element: HTMLElement | null = null): MapState {
  if (!element?.clientWidth || !element.clientHeight) {
    const span = Math.max(xmax - xmin, (ymax - ymin) * 1.6, 0.001);
    return { longitude: (xmin + xmax) / 2, latitude: (ymin + ymax) / 2, zoom: Math.max(1, Math.min(maximumZoom, Math.log2(360 / span) - 0.8)) };
  }
  const occupied = viewportInsets(element);
  const viewport = new WebMercatorViewport({ width: element.clientWidth, height: element.clientHeight });
  const fitted = viewport.fitBounds([[xmin, ymin], [xmax, ymax]], {
    maxZoom: maximumZoom,
    padding: { top: 24 + occupied.top, right: 24 + occupied.right, bottom: 24 + occupied.bottom, left: 24 + occupied.left },
  });
  return { longitude: fitted.longitude, latitude: fitted.latitude, zoom: fitted.zoom };
}

type TableSort = "name" | "sport" | "date" | "distance" | "gain" | "maximum";

function mapStyle(basemap: Basemap, theme: "light" | "dark"): maplibregl.StyleSpecification {
  if (basemap === "blank") return { ...blankStyle, layers: [{ id: "background", type: "background", paint: { "background-color": theme === "dark" ? "#07100e" : "#edf2ef" } }] };
  const source = rasterStyles[basemap];
  return { version: 8, sources: { basemap: { type: "raster", tiles: source.tiles, tileSize: 256, maxzoom: source.maxzoom, attribution: source.attribution } }, layers: [{ id: "basemap", type: "raster", source: "basemap" }] };
}

function BaseMap({ view, basemap, theme }: { view: MapState; basemap: Basemap; theme: "light" | "dark" }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const initialView = useRef(view);
  const initialBasemap = useRef(basemap);
  const initialTheme = useRef(theme);
  const appliedStyle = useRef(`${basemap}:${theme}`);
  useEffect(() => {
    if (!container.current) return;
    const initial = initialView.current;
    map.current = new maplibregl.Map({ container: container.current, style: mapStyle(initialBasemap.current, initialTheme.current), center: [initial.longitude, initial.latitude], zoom: initial.zoom, interactive: false, attributionControl: { compact: true } });
    const closeAttribution = () => container.current?.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
    window.setTimeout(closeAttribution, 0);
    window.setTimeout(closeAttribution, 750);
    return () => { map.current?.remove(); map.current = null; };
  }, []);
  useLayoutEffect(() => {
    // Deck and MapLibre are separate canvases. Apply the exact same camera
    // before paint so the basemap never displays one interaction frame behind
    // the route overlay (and wheel zoom retains deck.gl's cursor anchor).
    map.current?.jumpTo({ center: [view.longitude, view.latitude], zoom: view.zoom });
  }, [view]);
  useEffect(() => {
    const key = `${basemap}:${theme}`;
    if (appliedStyle.current === key) return;
    appliedStyle.current = key;
    map.current?.setStyle(mapStyle(basemap, theme));
  }, [basemap, theme]);
  return <div className="maplibre-base" ref={container} />;
}

function viewportBounds(view: MapState, element: HTMLElement | null, respectDrawer = false): ViewportBounds | undefined {
  if (!element) return undefined;
  const viewport = new WebMercatorViewport({ ...view, width: element.clientWidth, height: element.clientHeight });
  if (respectDrawer) {
    const inset = viewportInsets(element);
    const southwest = viewport.unproject([inset.left, element.clientHeight - inset.bottom]);
    const northeast = viewport.unproject([element.clientWidth - inset.right, inset.top]);
    return [southwest[0], southwest[1], northeast[0], northeast[1]];
  }
  return viewport.getBounds() as ViewportBounds;
}

function routeColor(value: string, alpha = 190): [number, number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(value);
  return match ? [Number.parseInt(match[1].slice(0, 2), 16), Number.parseInt(match[1].slice(2, 4), 16), Number.parseInt(match[1].slice(4, 6), 16), alpha] : [71, 107, 204, alpha];
}

export function App() {
  const engine = useMemo(() => new BrowserDuckDBEngine(), []);
  const [systemResolution, setSystemResolution] = useState<SystemResolution>(loadSystemResolution);
  engine.setResolution(systemResolution);
  const [tabs, setTabs] = useState(() => tabsWithUrlSettings(loadTabs()));
  const [active, setActive] = useState(() => {
    const requested = new URLSearchParams(window.location.search).get("tab");
    return tabs.some(item => item.id === requested) ? requested! : tabs[0].id;
  });
  const tab = tabs.find(item => item.id === active) ?? tabs[0];
  const [draft, setDraft] = useState(tab.sql);
  const [spatialDrawing, setSpatialDrawing] = useState(false);
  const [spatialDraft, setSpatialDraft] = useState<[number, number][]>([]);
  const [routeBatches, setRouteBatches] = useState<BinaryRouteBatch[]>([]);
  const [tableActivities, setTableActivities] = useState<ActivityListItem[]>([]);
  const [summary, setSummary] = useState(empty);
  const [status, setStatus] = useState("Ready for a local dataset");
  const [datasetName, setDatasetName] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [toolbarOpen, setToolbarOpen] = useState(false);
  const [schemaOpen, setSchemaOpen] = useState(false);
  const [schemaCopied, setSchemaCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [tableOpen, setTableOpen] = useState(false);
  const [renderingOpen, setRenderingOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [systemSettingsOpen, setSystemSettingsOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(() => window.location.pathname === "/auth/callback");
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [logoMenuOpen, setLogoMenuOpen] = useState(false);
  const [accountView, setAccountView] = useState<"account" | "upload" | "login">("account");
  const [sessionIdentity, setSessionIdentity] = useState(() => identityFromSession(loadSession()));
  const [tableLoading, setTableLoading] = useState(false);
  const [viewportScope, setViewportScope] = useState(false);
  const [scopedSummary, setScopedSummary] = useState(empty);
  const [scopeLoading, setScopeLoading] = useState(false);
  const [tableSort, setTableSort] = useState<TableSort>("date");
  const [tableDescending, setTableDescending] = useState(true);
  const [themeMode, setThemeMode] = useState<ThemeMode>(loadTheme);
  const [units, setUnits] = useState<UnitSystem>(loadUnits);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true);
  const [busy, setBusy] = useState(false);
  const [mapInteracting, setMapInteracting] = useState(false);
  const [selected, setSelected] = useState<RouteActivity | null>(null);
  const [isolateSelected, setIsolateSelected] = useState(false);
  const [hover, setHover] = useState<{ x: number; y: number; item: RouteMetadata; origin: "map" | "table" } | null>(null);
  const [profileHover, setProfileHover] = useState<ElevationSample | null>(null);
  const [mapSize, setMapSize] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const [view, setView] = useState(tab.mapState);
  const [renderedView, setRenderedView] = useState(tab.mapState);
  const [renderMetrics, setRenderMetrics] = useState({ lod: null as null | number, vertexCount: 0, geometryBufferBytes: 0, plannedVertexEstimate: 0, rawVertexEstimate: 0, vertexBudget: 0, visibleCount: 0, durationMs: 0, scan: emptyScan, cache: emptyCache });
  const [heat, setHeat] = useState<CooperativeHeatResult>(emptyHeat);
  const mapElement = useRef<HTMLElement>(null);
  const ready = useRef(false);
  const selectionReady = useRef(false);
  const viewportRequest = useRef(0);
  const panelRequest = useRef(0);
  const autoOpened = useRef(false);
  const initialUrlCamera = useRef(hasUrlCamera());
  const effectiveTheme = themeMode === "system" ? (systemDark ? "dark" : "light") : themeMode;
  const logoUrl = effectiveTheme === "dark" ? "/logo-dark.png" : "/logo-light.png";
  const refreshIdentity = useCallback(() => setSessionIdentity(identityFromSession(loadSession())), []);
  const distance = (meters: number) => `${integer.format(distanceValue(meters, units))} ${distanceUnit(units)}`;
  const elevation = (meters: number) => `${integer.format(elevationValue(meters, units))} ${elevationUnit(units)}`;

  useEffect(() => {
    const element = mapElement.current;
    if (!element) return;
    const update = () => setMapSize({ width: element.clientWidth, height: element.clientHeight });
    update();
    if (!("ResizeObserver" in window)) return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!tab.style.heatEnabled || isolateSelected) { setHeat(emptyHeat); return; }
    let cancelled = false;
    const element = mapElement.current;
    void buildBinaryHeatDataCooperative(
      routeBatches,
      renderedView,
      element?.clientWidth ?? 0,
      element?.clientHeight ?? 0,
      selected?.activityId,
      8,
      () => cancelled,
      systemResolution === "low" ? 4 : 8,
    ).then(result => { if (!cancelled && result) setHeat(result); });
    return () => { cancelled = true; };
  }, [isolateSelected, renderedView, routeBatches, selected?.activityId, systemResolution, tab.style.heatEnabled]);

  useEffect(() => {
    document.documentElement.dataset.theme = effectiveTheme;
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (icon) { icon.href = logoUrl; icon.type = "image/png"; }
  }, [effectiveTheme, logoUrl]);
  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!media) return;
    const update = () => setSystemDark(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (window.location.pathname === "/" && !window.location.search) return;
    const timer = window.setTimeout(() => replaceUrlSettings(tab, view, units), 180);
    return () => window.clearTimeout(timer);
  }, [tab, units, view]);

  async function run(queryTab = tab, mapState = view, sql = queryTab.id === tab.id ? draft : queryTab.sql) {
    try {
      if (!ready.current) throw new Error("Open a dataset first");
      selectionReady.current = false;
      setSelected(null); setProfileHover(null); setHover(null); setIsolateSelected(false);
      setTableOpen(false); setTableActivities([]);
      setBusy(true); setStatus("Running DuckDB SQL…"); setError("");
      const current = { ...queryTab, sql, mapState };
      const renderStarted = performance.now();
      const result = await engine.execute(current, mapState.zoom, viewportBounds(mapState, mapElement.current));
      setRouteBatches(result.batches); setRenderedView(mapState); setSummary(result.summary); setScopedSummary(result.summary);
      selectionReady.current = true;
      setRenderMetrics({ lod: result.lod, vertexCount: result.vertexCount, geometryBufferBytes: result.geometryBufferBytes, plannedVertexEstimate: result.plannedVertexEstimate, rawVertexEstimate: result.rawVertexEstimate, vertexBudget: result.vertexBudget, visibleCount: result.activityCount, durationMs: performance.now() - renderStarted, scan: result.scan, cache: result.cache });
      setStatus(`${result.summary.activityCount.toLocaleString()} routes selected`);
      setTabs(previous => {
        const updated = previous.map(item => item.id === queryTab.id ? current : item);
        saveTabs(updated); return updated;
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setStatus("Query failed · previous result preserved");
    } finally { setBusy(false); }
  }

  async function openSource(source: DatasetSource, requestedView?: MapState, initialTab = tab) {
    try {
      setBusy(true); setError(""); setStatus("Reading dataset manifest…");
      const dataset = await engine.openDataset(source, (completed, total) => setStatus(`Opening dataset · ${completed.toLocaleString()} / ${total.toLocaleString()} files`));
      ready.current = true; setDatasetName(dataset.name);
      const initialView = requestedView ?? fitBounds(dataset.manifest.bbox);
      setView(initialView);
      setStatus("Running initial query…"); await run(initialTab, initialView, initialTab.sql);
    } catch (reason) {
      ready.current = false; setError(reason instanceof Error ? reason.message : String(reason));
      setStatus("Dataset could not be opened");
    } finally { setBusy(false); }
  }

  async function openDirectory() {
    if (!("showDirectoryPicker" in window)) { setError("Directory selection requires a Chromium-based browser"); return; }
    const handle = await window.showDirectoryPicker({ mode: "read" });
    await openSource({ kind: "directory", handle });
  }

  useEffect(() => {
    if (autoOpened.current) return;
    const published = publishedSlug();
    const shared = sharedDatasetId();
    const local = new URLSearchParams(window.location.search).get("dataset");
    if (!published && !shared && (!local || !/^[a-zA-Z0-9_-]+$/.test(local))) {
      autoOpened.current = true;
      void (async () => {
        try {
          const config = await loadRuntimeConfig();
          if (!config?.defaultDatasetId) return;
          const hostedDatasetRoot = (import.meta.env.VITE_DATASET_BASE_URL as string | undefined)?.replace(/\/$/, "") ?? "/datasets";
          await openSource({ kind: "url", baseUrl: `${hostedDatasetRoot}/${config.defaultDatasetId}`, name: config.defaultDatasetId });
        } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
      })();
      return;
    }
    autoOpened.current = true;
    if (published) {
      void (async () => {
        try {
          const config = await loadRuntimeConfig();
          if (!config) throw new Error("Published maps are unavailable.");
          const saved = await loadPublishedView(config, published);
          const selected = saved.tabs.find(item => item.id === saved.active) ?? saved.tabs[0];
          setTabs(saved.tabs); setActive(selected.id); setDraft(selected.sql); setView(selected.mapState);
          if (saved.datasetId) {
            const hostedDatasetRoot = (import.meta.env.VITE_DATASET_BASE_URL as string | undefined)?.replace(/\/$/, "") ?? "/datasets";
            await openSource({ kind: "url", baseUrl: `${hostedDatasetRoot}/${saved.datasetId}`, name: saved.datasetId }, selected.mapState, selected);
          } else setStatus("Published map settings loaded");
        } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
      })();
      return;
    }
    const hostedDatasetRoot = (import.meta.env.VITE_DATASET_BASE_URL as string | undefined)?.replace(/\/$/, "") ?? "/datasets";
    const source = shared
      ? { kind: "url" as const, baseUrl: `${hostedDatasetRoot}/${shared}`, name: shared }
      : { kind: "url" as const, baseUrl: `/local-data/${local!}`, name: local! };
    void openSource(source, initialUrlCamera.current ? view : undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!ready.current || !selectionReady.current || mapInteracting) return;
    const request = ++viewportRequest.current;
    const timer = window.setTimeout(async () => {
      const bounds = viewportBounds(view, mapElement.current);
      if (!bounds) return;
      try {
        const renderStarted = performance.now();
        const result = await engine.renderViewport(view.zoom, bounds);
        if (request !== viewportRequest.current) return;
        setRouteBatches(result.batches); setRenderedView(view);
        setRenderMetrics({ lod: result.lod, vertexCount: result.vertexCount, geometryBufferBytes: result.geometryBufferBytes, plannedVertexEstimate: result.plannedVertexEstimate, rawVertexEstimate: result.rawVertexEstimate, vertexBudget: result.vertexBudget, visibleCount: result.activityCount, durationMs: performance.now() - renderStarted, scan: result.scan, cache: result.cache });
      } catch (reason) {
        if (request === viewportRequest.current) setError(reason instanceof Error ? reason.message : String(reason));
      }
    }, 180);
    return () => window.clearTimeout(timer);
  }, [engine, mapInteracting, summary.activityCount, systemResolution, view]);

  useEffect(() => {
    if (!viewportScope || (!statsOpen && !tableOpen) || !selectionReady.current) return;
    const request = ++panelRequest.current;
    const timer = window.setTimeout(async () => {
      const bounds = viewportBounds(renderedView, mapElement.current, true);
      if (!bounds) return;
      try {
        setScopeLoading(true); setError("");
        if (statsOpen) {
          const result = await engine.getSummary(bounds);
          if (request === panelRequest.current) setScopedSummary(result);
        } else if (tableOpen) {
          const result = await engine.getActivities(bounds);
          if (request === panelRequest.current) setTableActivities(result);
        }
      } catch (reason) {
        if (request === panelRequest.current) setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        if (request === panelRequest.current) { setScopeLoading(false); setTableLoading(false); }
      }
    }, 120);
    return () => window.clearTimeout(timer);
  }, [engine, renderedView, statsOpen, tableOpen, viewportScope]);

  function choose(next: QueryTab, openQuery = false) {
    const isCurrent = next.id === active;
    setSpatialDrawing(false); setSpatialDraft([]);
    if (isCurrent) setToolbarOpen(open => !open);
    else { setActive(next.id); setDraft(next.sql); setView(next.mapState); setRenderedView(next.mapState); setToolbarOpen(openQuery); }
    replaceUrlSettings(next, next.mapState, units); setSelected(null); setProfileHover(null); setHover(null); setIsolateSelected(false); setStatsOpen(false); setTableOpen(false); setRenderingOpen(false); setAboutOpen(false);
    if (ready.current && !isCurrent) void run(next, next.mapState, next.sql);
  }
  function add() {
    // A query changes the selected routes, not the place the user is looking
    // at. New tabs therefore inherit the live camera and visual settings.
    const next = { ...defaultTab, mapState: { ...view }, style: { ...tab.style }, id: crypto.randomUUID(), title: "New Query" };
    const updated = [...tabs, next]; setTabs(updated); saveTabs(updated); choose(next, true);
  }
  function duplicate() {
    const next = { ...tab, style: { ...tab.style }, spatialFilter: tab.spatialFilter ? { ...tab.spatialFilter, polygon: [...tab.spatialFilter.polygon] } : undefined, id: crypto.randomUUID(), title: `${tab.title} copy`, sql: draft };
    const updated = [...tabs, next]; setTabs(updated); saveTabs(updated); choose(next, true);
  }
  function remove() {
    if (tabs.length === 1) return;
    const updated = tabs.filter(item => item.id !== tab.id); setTabs(updated); saveTabs(updated); choose(updated[0]);
  }
  function rename(title: string) { const updated = tabs.map(item => item.id === tab.id ? { ...item, title } : item); setTabs(updated); saveTabs(updated); }
  function changeStyle(style: Partial<QueryTab["style"]>) {
    const nextTab = { ...tab, style: { ...tab.style, ...style } };
    const updated = tabs.map(item => item.id === tab.id ? nextTab : item);
    setTabs(updated); saveTabs(updated);
    // Clean changes the logical activities view, so refresh the last
    // successfully executed SQL automatically. Unsaved SQL remains a draft.
    if (style.cleanEnabled !== undefined && style.cleanEnabled !== tab.style.cleanEnabled && ready.current) void run(nextTab, view, tab.sql);
  }
  function saveSpatialFilter(spatialFilter: QueryTab["spatialFilter"], rerun: boolean) {
    const nextTab = { ...tab, spatialFilter };
    const updated = tabs.map(item => item.id === tab.id ? nextTab : item);
    setTabs(updated); saveTabs(updated);
    if (rerun && ready.current) void run(nextTab, view, tab.sql);
  }
  function changeSpatialPredicate(predicate: SpatialPredicate) {
    const spatialFilter = { predicate, polygon: tab.spatialFilter?.polygon ?? [], visible: tab.spatialFilter?.visible ?? false };
    saveSpatialFilter(spatialFilter, spatialFilter.polygon.length >= 3);
  }
  function startSpatialDraw() {
    setSpatialDraft([]); setSpatialDrawing(true); setToolbarOpen(false); setSelected(null); setProfileHover(null); setHover(null);
  }
  function acceptSpatialDraw() {
    if (spatialDraft.length < 3) return;
    const spatialFilter = { predicate: tab.spatialFilter?.predicate ?? "intersects" as const, polygon: spatialDraft, visible: false };
    setSpatialDrawing(false); setSpatialDraft([]); saveSpatialFilter(spatialFilter, true);
  }
  function clearSpatialFilter() { setSpatialDrawing(false); setSpatialDraft([]); saveSpatialFilter(undefined, true); }
  function changeTheme(theme: ThemeMode) { setThemeMode(theme); saveTheme(theme); }
  function changeUnits(next: UnitSystem) { setUnits(next); saveUnits(next); }
  function changeSystemResolution(next: SystemResolution) { setSystemResolution(next); saveSystemResolution(next); }
  function openSystemSettings() {
    setSystemSettingsOpen(true); setMenuOpen(false); setSchemaOpen(false); setToolbarOpen(false); setStatsOpen(false); setTableOpen(false); setRenderingOpen(false); setAboutOpen(false);
  }
  const openActivity = useCallback(async (activity: RouteMetadata) => {
    setStatsOpen(false); setTableOpen(false); setRenderingOpen(false); setAboutOpen(false); setToolbarOpen(false);
    setSelected(null); setProfileHover(null); setHover(null); setIsolateSelected(false);
    const detail = await engine.getActivity(activity.activityId);
    if (detail) setSelected(detail);
  }, [engine]);
  async function openTableActivity(activity: ActivityListItem) {
    setTableOpen(false); setSelected(null); setProfileHover(null);
    setView(fitBounds(activity.bounds, 16, mapElement.current));
    try {
      const detail = await engine.getActivity(activity.activityId);
      if (detail) setSelected(detail);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }
  function zoomToSelected() {
    if (!selected?.fullPath.length) return;
    const longitudes = selected.fullPath.map(point => point[0]);
    const latitudes = selected.fullPath.map(point => point[1]);
    setView(fitBounds([Math.min(...longitudes), Math.min(...latitudes), Math.max(...longitudes), Math.max(...latitudes)], 16, mapElement.current));
  }
  async function copySchema() {
    await navigator.clipboard.writeText(QUERY_SCHEMA);
    setSchemaCopied(true); window.setTimeout(() => setSchemaCopied(false), 1500);
  }
  async function copyTabLink() {
    replaceUrlSettings(tab, view, units);
    const url = new URL(window.location.href);
    await navigator.clipboard.writeText(url.toString());
    setLinkCopied(true); window.setTimeout(() => setLinkCopied(false), 1500);
  }
  async function publishTabs() {
    const session = loadSession();
    if (!session) { setAccountView("login"); setAccountOpen(true); return; }
    try {
      const config = await loadRuntimeConfig();
      if (!config) throw new Error("Publishing is unavailable.");
      const currentTabs = tabs.map(item => item.id === tab.id ? { ...item, mapState: view, sql: draft } : item);
      const datasetId = datasetName && /^[0-9a-f-]{36}$/i.test(datasetName) ? datasetName : null;
      const published = await publishView(config, session, currentTabs, tab.id, datasetId);
      await navigator.clipboard.writeText(`${window.location.origin}${published.url}`);
      setStatus("Published link copied"); setLinkCopied(true); window.setTimeout(() => setLinkCopied(false), 1500);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); refreshIdentity(); }
  }

  function toggleStats() {
    setSelected(null); setProfileHover(null); setIsolateSelected(false);
    setTableOpen(false); setRenderingOpen(false); setAboutOpen(false); setToolbarOpen(false); setStatsOpen(open => !open);
  }
  async function toggleTable() {
    if (tableOpen) { setTableOpen(false); return; }
    setSelected(null); setProfileHover(null); setIsolateSelected(false);
    setStatsOpen(false); setRenderingOpen(false); setAboutOpen(false); setToolbarOpen(false); setTableOpen(true);
    if (!selectionReady.current || viewportScope) { setTableLoading(viewportScope); return; }
    try {
      setTableLoading(true); setError("");
      setTableActivities(await engine.getActivities());
    } catch (reason) {
      setTableOpen(false); setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setTableLoading(false);
    }
  }

  function changeViewportScope(enabled: boolean) {
    panelRequest.current += 1;
    setViewportScope(enabled);
    if (!enabled) {
      setScopedSummary(summary);
      if (tableOpen) {
        setTableLoading(true);
        void engine.getActivities().then(setTableActivities).catch(reason => setError(reason instanceof Error ? reason.message : String(reason))).finally(() => setTableLoading(false));
      }
    } else if (tableOpen) {
      setTableLoading(true);
    }
  }

  function toggleTableSort(next: typeof tableSort) {
    if (next === tableSort) setTableDescending(value => !value);
    else { setTableSort(next); setTableDescending(next !== "name" && next !== "sport"); }
  }
  const tableRows = useMemo(() => [...tableActivities].sort((left, right) => {
    const values: Record<typeof tableSort, [string | number, string | number]> = {
      name: [left.name, right.name],
      sport: [left.sportType, right.sportType],
      date: [left.startTime ?? "", right.startTime ?? ""],
      distance: [left.distanceM ?? -1, right.distanceM ?? -1],
      gain: [left.elevationGainM ?? -1, right.elevationGainM ?? -1],
      maximum: [left.maxElevationM ?? -1, right.maxElevationM ?? -1],
    };
    const [a, b] = values[tableSort];
    const order = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b));
    return tableDescending ? -order : order;
  }), [tableActivities, tableDescending, tableSort]);

  const overviewBatches = useMemo(() => isolateSelected ? [] : routeBatches, [isolateSelected, routeBatches]);
  const overviewColors = useMemo(() => routeBatches.map(batch => routeColors(batch, activity => {
    if (activity.activityId === selected?.activityId) return [0, 0, 0, 0];
    return tab.style.heatEnabled
      ? colorForWeight(heat.scores.get(activity.activityId) ?? 0, heat.maxScore, tab.style.heatPalette, tab.style.heatTemperature)
      : routeColor(tab.style.color, 190);
  })), [heat, routeBatches, selected, tab.style.color, tab.style.heatEnabled, tab.style.heatPalette, tab.style.heatTemperature]);
  const hoverColors = useMemo(() => hover ? routeBatches.map(batch => routeColors(batch, activity => activity.activityId === hover.item.activityId ? routeColor(tab.style.color, 255) : [0, 0, 0, 0])) : [], [hover, routeBatches, tab.style.color]);
  const overviewPathData = useMemo(() => routeBatches.map((batch, index) => binaryPathData(batch, overviewColors[index])), [overviewColors, routeBatches]);
  const pickingPathData = useMemo(() => routeBatches.map(batch => binaryPathData(batch)), [routeBatches]);
  const hoverPathData = useMemo(() => hover ? routeBatches.map((batch, index) => binaryPathData(batch, hoverColors[index])) : [], [hover, hoverColors, routeBatches]);
  const selectedSegments = useMemo(() => selected ? routeSegments([selected], true) : [], [selected]);
  const lineWidths = useMemo(() => lineWidthsForViewport(tab.style.lineWidthScale, mapSize.width, mapSize.height), [mapSize, tab.style.lineWidthScale]);
  const layers = useMemo(() => [
    ...spatialLayers(tab.spatialFilter, spatialDrawing, spatialDraft),
    ...overviewBatches.flatMap((batch, index) => [
      new PathLayer({ id: `routes-${index}`, data: overviewPathData[index], _pathType: "open", positionFormat: "XY", getWidth: tab.style.heatEnabled ? lineWidths.heat : lineWidths.route, widthUnits: "pixels", widthMinPixels: 0.35, pickable: false }),
      new PathLayer({ id: `route-hit-targets-${index}`, data: pickingPathData[index], _pathType: "open", positionFormat: "XY", getColor: [0, 0, 0, 0], getWidth: lineWidths.route + 10, widthUnits: "pixels", widthMinPixels: 10, pickable: !spatialDrawing, onHover: (info: PickingInfo) => { if (spatialDrawing) return; const item = info.index >= 0 ? pickedActivity(batch, info.index) : null; setHover(item ? { x: info.x, y: info.y, item, origin: "map" } : null); }, onClick: (info: PickingInfo) => { if (spatialDrawing) return; const item = info.index >= 0 ? pickedActivity(batch, info.index) : null; if (item) void openActivity(item); } }),
    ]),
    ...(hover && !spatialDrawing ? routeBatches.map((batch, index) =>
      new PathLayer({ id: `hover-route-${index}`, data: hoverPathData[index], _pathType: "open", positionFormat: "XY", getWidth: lineWidths.focus, widthUnits: "pixels", widthMinPixels: 0.8 }),
    ) : []),
    ...(selected && isolateSelected ? [
      new PathLayer<RouteSegment>({ id: "isolated-route", data: selectedSegments, getPath: item => item.path, getColor: routeColor(tab.style.color, 255), getWidth: lineWidths.route, widthUnits: "pixels", widthMinPixels: 0.35, pickable: !spatialDrawing }),
    ] : selected ? [
      new PathLayer<RouteSegment>({ id: "selected-route", data: selectedSegments, getPath: item => item.path, getColor: routeColor(tab.style.color, 255), getWidth: lineWidths.focus, widthUnits: "pixels", widthMinPixels: 0.8, pickable: !spatialDrawing }),
    ] : []),
    ...(profileHover && !spatialDrawing ? [new ScatterplotLayer<ElevationSample>({ id: "profile-position", data: [profileHover], getPosition: item => item.position, getFillColor: [71, 107, 204, 255], getLineColor: [255, 255, 255, 255], getRadius: 8, radiusUnits: "pixels", stroked: true, lineWidthMinPixels: 3 })] : []),
  ], [hover, hoverPathData, isolateSelected, lineWidths, openActivity, overviewBatches, overviewPathData, pickingPathData, profileHover, routeBatches, selected, selectedSegments, spatialDraft, spatialDrawing, tab.spatialFilter, tab.style.color, tab.style.heatEnabled]);

  return <main className="app" onKeyDown={event => { if (spatialDrawing && event.key === "Escape") { setSpatialDrawing(false); setSpatialDraft([]); return; } if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void run(); }}>
    <header className="topbar">
      <div className="brand"><button className={`brand-button ${logoMenuOpen ? "active" : ""}`} aria-label="Open Squiggles menu" data-tooltip="Squiggles menu" aria-expanded={logoMenuOpen} onClick={() => { setLogoMenuOpen(open => !open); setMenuOpen(false); setAccountMenuOpen(false); }}><img src={logoUrl} alt="Squiggles" /></button></div>
      <button className="mobile-query-title" aria-label={menuOpen ? "Close query menu" : "Open query menu"} aria-expanded={menuOpen} onClick={() => { setMenuOpen(open => !open); setLogoMenuOpen(false); setAccountMenuOpen(false); setSystemSettingsOpen(false); }}>{tab.title}</button>
      <div className={`status ${busy ? "working" : ""}`} role="status" aria-label={status}><span /></div>
      {sessionIdentity.email ? <button className="avatar-button" aria-label="Open account menu" aria-expanded={accountMenuOpen} onClick={() => { setAccountMenuOpen(open => !open); setMenuOpen(false); setLogoMenuOpen(false); }}>{sessionIdentity.picture ? <img src={sessionIdentity.picture} alt="" referrerPolicy="no-referrer" /> : <span>{(sessionIdentity.name || sessionIdentity.email).slice(0, 1).toUpperCase()}</span>}</button> : <button className="login-button" onClick={() => { setAccountView("login"); setAccountOpen(true); setLogoMenuOpen(false); setMenuOpen(false); }}>Log in</button>}
    </header>

    {logoMenuOpen && <nav className="logo-menu utility-panel" aria-label="Squiggles navigation"><button onClick={() => { setAboutOpen(true); setLogoMenuOpen(false); setStatsOpen(false); setTableOpen(false); setRenderingOpen(false); setToolbarOpen(false); }}>About</button><button disabled={busy} onClick={() => { void openDirectory(); setLogoMenuOpen(false); }}>{datasetName ? `Change dataset · ${datasetName}` : "Open dataset"}</button><button onClick={() => { setSchemaOpen(true); setLogoMenuOpen(false); }}>AI Skills</button><button onClick={() => { openSystemSettings(); setLogoMenuOpen(false); }}>System settings</button></nav>}

    {menuOpen && <nav className="mobile-menu utility-panel" aria-label="Query navigation">
      <section><span className="eyebrow">SAVED QUERIES</span>{tabs.map(item => <button className={item.id === tab.id ? "active" : ""} key={item.id} onClick={() => { choose(item); setMenuOpen(false); }}>{item.title}</button>)}<button onClick={() => { add(); setMenuOpen(false); }}>New query</button></section>
      <section><button onClick={() => { choose(tab, true); setMenuOpen(false); }}>Query settings</button><button disabled={!selectionReady.current} onClick={() => { toggleStats(); setMenuOpen(false); }}>Statistics</button><button disabled={!selectionReady.current || tableLoading} onClick={() => { void toggleTable(); setMenuOpen(false); }}>Table</button><button disabled={!selectionReady.current} onClick={() => { setRenderingOpen(true); setStatsOpen(false); setTableOpen(false); setAboutOpen(false); setToolbarOpen(false); setSchemaOpen(false); setMenuOpen(false); setSelected(null); setProfileHover(null); setIsolateSelected(false); }}>Rendering</button></section>
    </nav>}

    {accountMenuOpen && <nav className="account-menu utility-panel" aria-label="Account navigation"><button onClick={() => { setAccountView("account"); setAccountOpen(true); setAccountMenuOpen(false); }}>Account</button><button onClick={() => { setAccountView("upload"); setAccountOpen(true); setAccountMenuOpen(false); }}>Upload Archive</button><button onClick={() => { void publishTabs(); setAccountMenuOpen(false); }}>Publish link</button><button onClick={() => { clearSession(); refreshIdentity(); setAccountMenuOpen(false); }}>Log out</button></nav>}

    {systemSettingsOpen && <section className="system-settings utility-panel" aria-label="System settings"><header><div><span className="eyebrow">SYSTEM</span><strong>Appearance and performance</strong></div><button aria-label="Close system settings" onClick={() => setSystemSettingsOpen(false)}>×</button></header><div><label>Theme</label><div className="theme-control" role="group" aria-label="Theme"><button aria-label="Use light theme" aria-pressed={themeMode === "light"} title="Light theme" onClick={() => changeTheme("light")}>☀︎</button><button aria-label="Use system theme" aria-pressed={themeMode === "system"} title="Follow system theme" onClick={() => changeTheme("system")}>◐</button><button aria-label="Use dark theme" aria-pressed={themeMode === "dark"} title="Dark theme" onClick={() => changeTheme("dark")}>☾</button></div></div><div><label>Distance and elevation</label><div className="unit-control" role="group" aria-label="Units"><button aria-label="Use imperial units" aria-pressed={units === "imperial"} title="Show miles and feet" onClick={() => changeUnits("imperial")}>mi</button><button aria-label="Use metric units" aria-pressed={units === "metric"} title="Show kilometres and metres" onClick={() => changeUnits("metric")}>km</button></div></div><div><label>Map resolution</label><div className="resolution-control" role="group" aria-label="Map resolution"><button aria-pressed={systemResolution === "low"} onClick={() => changeSystemResolution("low")}>Low</button><button aria-pressed={systemResolution === "medium"} onClick={() => changeSystemResolution("medium")}>Medium</button><button aria-pressed={systemResolution === "high"} onClick={() => changeSystemResolution("high")}>High</button></div></div></section>}
    {accountOpen && <AccountPanel view={accountView} onClose={() => setAccountOpen(false)} onIdentityChange={refreshIdentity} />}

    {schemaOpen && <section className="schema-panel utility-panel" aria-label="AI Skills"><header><strong>AI Skills · Squiggles SQL</strong><div><button onClick={() => void copySchema()}>{schemaCopied ? "Copied" : "Copy for your AI"}</button><button aria-label="Close AI Skills" onClick={() => setSchemaOpen(false)}>×</button></div></header><p>Paste this into the AI assistant of your choice, then describe the activities you want to select.</p><pre>{QUERY_SCHEMA}</pre></section>}

    {toolbarOpen && <section className="toolbar" aria-label="Query and map settings">
      <header className="toolbar-header"><div><span className="eyebrow">QUERY TAB</span><input aria-label="Tab title" className="rename" title="Name this saved query tab" value={tab.title} onChange={event => rename(event.target.value)} /></div><button aria-label="Close query settings" onClick={() => setToolbarOpen(false)}>×</button></header>
      <section className="toolbar-section"><h3>Map</h3><div className="settings-grid">
        <label data-tooltip="Choose streets, topographic, imagery, or a fully offline map.">Basemap<select aria-label="Basemap" value={tab.style.basemap} onChange={event => changeStyle({ basemap: event.target.value as Basemap })}><option value="streets">Streets</option><option value="topo">Topographic</option><option value="imagery">Imagery</option><option value="blank">Blank / offline</option></select></label>
        <label data-tooltip="Choose the base route and hover-highlight color.">Route color<input aria-label="Route color" type="color" value={tab.style.color} onChange={event => changeStyle({ color: event.target.value })} /></label>
        <label className="temperature" data-tooltip="Multiply a route width equal to 0.15% of the map's shorter dimension. The width stays visually consistent at every zoom."><span>Thickness</span><input aria-label="Route thickness" type="range" min="0.25" max="4" step="0.05" value={tab.style.lineWidthScale} onChange={event => changeStyle({ lineWidthScale: Number(event.target.value) })} /><output>{tab.style.lineWidthScale.toFixed(2)}×</output></label>
      </div></section>
      <section className="toolbar-section"><h3>Heat</h3><div className="settings-grid">
        <label className="check" data-tooltip="Give each complete route one color based on nearby vertices from other routes in the current SQL selection."><input aria-label="Heat" type="checkbox" checked={tab.style.heatEnabled} onChange={event => changeStyle({ heatEnabled: event.target.checked })} /> Enabled</label>
        <label data-tooltip="Choose the color ramp for route proximity.">Colors<select aria-label="Heat colormap" value={tab.style.heatPalette} disabled={!tab.style.heatEnabled} onChange={event => changeStyle({ heatPalette: event.target.value as HeatPalette })}><option value="sunset">Sunset</option><option value="viridis">Viridis</option><option value="fire">Fire</option><option value="ice">Ice</option></select></label>
        <label className="temperature" data-tooltip="Higher values make less-frequent shared routes reach saturated colors sooner."><span>Temperature</span><input aria-label="Heat temperature" type="range" min="0.5" max="3" step="0.1" disabled={!tab.style.heatEnabled} value={tab.style.heatTemperature} onChange={event => changeStyle({ heatTemperature: Number(event.target.value) })} /><output>{tab.style.heatTemperature.toFixed(1)}×</output></label>
      </div></section>
      <section className="toolbar-section"><h3>Spatial filter</h3><div className="spatial-filter-controls"><label data-tooltip="Intersects selects routes that enter or cross the drawn area. Entirely within requires the whole route to stay inside it.">Predicate<select aria-label="Spatial predicate" value={tab.spatialFilter?.predicate ?? "intersects"} onChange={event => changeSpatialPredicate(event.target.value as SpatialPredicate)}><option value="intersects">Intersects area</option><option value="within">Entirely within area</option></select></label><button onClick={startSpatialDraw}>{tab.spatialFilter?.polygon.length ? "Redraw area" : "Draw area"}</button></div>{Boolean(tab.spatialFilter?.polygon.length) && <><p className="spatial-filter-summary">{tab.spatialFilter?.predicate === "within" ? "Entire route within" : "Intersects"} · {tab.spatialFilter!.polygon.length} vertices</p><div className="spatial-filter-actions"><button onClick={() => saveSpatialFilter({ ...tab.spatialFilter!, visible: !tab.spatialFilter!.visible }, false)}>{tab.spatialFilter?.visible ? "Hide area" : "Show area"}</button><button onClick={clearSpatialFilter}>Clear</button></div></>}</section>
      <section className="toolbar-section"><h3>Data</h3><label className="check" data-tooltip="Run the last successful SQL automatically against a derived view that excludes isolated GPS jumps and elevation spikes. Unsaved SQL stays a draft and raw files are unchanged."><input aria-label="Clean" type="checkbox" checked={tab.style.cleanEnabled} onChange={event => changeStyle({ cleanEnabled: event.target.checked })} /> Clean anomalous points</label></section>
      <section className="toolbar-section sql-section"><div className="section-heading"><div><h3>SQL</h3><p>{draft === tab.sql ? "Current query is applied" : "Draft changed · run to apply"}</p></div><button className="run" title="Run this DuckDB SQL query" disabled={busy || !ready.current} onClick={() => void run()}>▶ Run <kbd>⌘↵</kbd></button></div><Suspense fallback={<div className="sql-loading">Loading SQL editor…</div>}><SqlEditor value={draft} dark={effectiveTheme === "dark"} onChange={setDraft} /></Suspense></section>
      <section className="toolbar-section tab-actions"><h3>Tab</h3><div><button title="Copy a link with this tab, camera, and map settings" onClick={() => void copyTabLink()}>{linkCopied ? "Link copied" : "Copy tab link"}</button><button title="Duplicate this query and its map settings" onClick={duplicate}>Duplicate</button><button title="Delete this saved query" onClick={remove} disabled={tabs.length === 1}>Delete</button></div></section>
    </section>}
    {error && <div className="error global-error"><strong>Something needs attention</strong><span>{error}</span></div>}

    <section className={`map ${spatialDrawing ? "spatial-drawing" : ""}`} ref={mapElement}>
      <BaseMap view={view} basemap={tab.style.basemap} theme={effectiveTheme} />
      <DeckGL controller={spatialDrawing ? false : { dragRotate: false, touchRotate: false }} layers={layers} viewState={{ ...view, bearing: 0, pitch: 0 }} onInteractionStateChange={interactionState => setMapInteracting(Boolean(interactionState.isDragging || interactionState.isPanning || interactionState.isZooming))} onViewStateChange={({ viewState, interactionState }) => {
        // Ignore camera callbacks produced while an asynchronously loaded published
        // view is being applied. Only a real pointer/wheel gesture may own the camera.
        if (!interactionState.isDragging && !interactionState.isPanning && !interactionState.isZooming) return;
        const next = viewState as MapState;
        setView({ longitude: next.longitude, latitude: next.latitude, zoom: next.zoom });
      }} onClick={info => { if (spatialDrawing) { const coordinate = info.coordinate; if (coordinate?.length >= 2) setSpatialDraft(previous => [...previous, [coordinate[0], coordinate[1]]]); return; } if (!info.object) { setSelected(null); setProfileHover(null); } }} />
      {spatialDrawing && <><div className="spatial-draw-tools" role="group" aria-label="Polygon drawing controls"><button aria-label="Undo last polygon vertex" title="Undo last point" disabled={spatialDraft.length === 0} onClick={() => setSpatialDraft(previous => previous.slice(0, -1))}>↶</button><button className="accept" aria-label="Accept polygon" title="Accept polygon" disabled={spatialDraft.length < 3} onClick={acceptSpatialDraw}>✓</button></div><div className="spatial-draw-hint">Tap the map to add polygon vertices · ↶ undo · ✓ apply</div></>}
      {!spatialDrawing && hover?.origin === "map" && <div className="tooltip" style={{ left: hover.x + 12, top: hover.y + 12 }}><strong>{hover.item.name}</strong><span>{hover.item.sportType} · {hover.item.startTime?.slice(0, 10)}</span><span>{distance(hover.item.distanceM ?? 0)} · {elevation(hover.item.elevationGainM ?? 0)} gain</span></div>}
    </section>

    {selected && <aside className="detail" aria-label="Activity detail"><button className="close" aria-label="Close detail" onClick={() => { setSelected(null); setProfileHover(null); setIsolateSelected(false); }}>×</button><span className="eyebrow">{selected.sportType}</span><h2>{selected.name}</h2><p className="detail-date">{selected.startTime?.slice(0, 10)}</p><div className="detail-stats"><Stat value={distance(selected.distanceM ?? 0)} label="distance" /><Stat value={elevation(selected.elevationGainM ?? 0)} label="gain" /><Stat value={selected.maxElevationM == null ? "—" : elevation(selected.maxElevationM)} label="maximum" /></div><div className="detail-actions"><button onClick={zoomToSelected}>Zoom to route</button><button className={`isolate ${isolateSelected ? "active" : ""}`} aria-pressed={isolateSelected} onClick={() => setIsolateSelected(value => !value)}>{isolateSelected ? "Show all routes" : "Show only this route"}</button></div><ElevationProfile samples={selected.elevationProfile} active={profileHover} units={units} onHover={setProfileHover} />{selected.sourceUrl && <a href={selected.sourceUrl} target="_blank" rel="noreferrer">Open original activity ↗</a>}</aside>}
    {statsOpen && <section className="rich-stats" aria-label="Detailed selection statistics"><header><img src={logoUrl} alt="" /><div><span className="eyebrow">{viewportScope ? "CONTAINED IN VIEWPORT" : "CURRENT SELECTION"}</span><h2>{scopeLoading && viewportScope ? "Updating…" : `${integer.format((viewportScope ? scopedSummary : summary).activityCount)} activities`}</h2></div><button aria-label="Close statistics" onClick={() => setStatsOpen(false)}>×</button></header><ScopeToggle checked={viewportScope} onChange={changeViewportScope} /><Stats summary={viewportScope ? scopedSummary : summary} distance={distance} elevation={elevation} /></section>}
    {tableOpen && <section className="activity-table" aria-label="Activity table"><header><div><span className="eyebrow">{viewportScope ? "CONTAINED IN VIEWPORT" : "CURRENT SELECTION"}</span><h2>{tableLoading || (scopeLoading && viewportScope) ? "Loading activities…" : `${integer.format(tableActivities.length)} activities`}</h2></div><ScopeToggle checked={viewportScope} onChange={changeViewportScope} /><span>Hover to highlight · click to zoom</span><button aria-label="Close activity table" onClick={() => { setTableOpen(false); setHover(null); }}>×</button></header><div className="table-scroll"><table><thead><tr><SortableHeader label="Activity" field="name" active={tableSort} descending={tableDescending} onSort={toggleTableSort} /><SortableHeader label="Sport" field="sport" active={tableSort} descending={tableDescending} onSort={toggleTableSort} /><SortableHeader label="Date" field="date" active={tableSort} descending={tableDescending} onSort={toggleTableSort} /><SortableHeader label="Distance" field="distance" active={tableSort} descending={tableDescending} onSort={toggleTableSort} /><SortableHeader label="Gain" field="gain" active={tableSort} descending={tableDescending} onSort={toggleTableSort} /><SortableHeader label="Maximum" field="maximum" active={tableSort} descending={tableDescending} onSort={toggleTableSort} /></tr></thead><tbody>{tableRows.map(item => <tr key={item.activityId} className={selected?.activityId === item.activityId || hover?.origin === "table" && hover.item.activityId === item.activityId ? "selected" : ""} onMouseEnter={() => setHover({ x: 0, y: 0, item, origin: "table" })} onMouseLeave={() => setHover(current => current?.origin === "table" && current.item.activityId === item.activityId ? null : current)} onClick={() => void openTableActivity(item)}><td><strong>{item.name}</strong></td><td>{item.sportType}</td><td>{item.startTime?.slice(0, 10) ?? "—"}</td><td>{item.distanceM == null ? "—" : `${distanceValue(item.distanceM, units).toFixed(1)} ${distanceUnit(units)}`}</td><td>{item.elevationGainM == null ? "—" : elevation(item.elevationGainM)}</td><td>{item.maxElevationM == null ? "—" : elevation(item.maxElevationM)}</td></tr>)}</tbody></table>{!tableLoading && tableRows.length === 0 && <div className="table-empty">No selected activities are fully contained in the visible viewport.</div>}</div></section>}
    {renderingOpen && <section className="rich-stats diagnostics-drawer" aria-label="Rendering diagnostics"><header><div><span className="eyebrow">BROWSER RENDER PLAN</span><h2>{renderMetrics.lod === 4 ? "Raw geometry" : renderMetrics.lod == null ? "Waiting for geometry" : `LOD ${renderMetrics.lod}`}</h2></div><button aria-label="Close rendering diagnostics" onClick={() => setRenderingOpen(false)}>×</button></header><table><tbody><Diagnostic label="Representation" value={renderMetrics.lod === 4 ? "LOD 4 · raw coordinates" : renderMetrics.lod == null ? "—" : `LOD ${renderMetrics.lod} · simplified overview`} /><Diagnostic label="Map zoom" value={renderedView.zoom.toFixed(2)} /><Diagnostic label="Fragments read" value={`${integer.format(renderMetrics.scan.candidateFragmentCount)} / ${integer.format(renderMetrics.scan.totalFragmentCount)}`} /><Diagnostic label="Candidate Parquet bytes" value={`${bytes(renderMetrics.scan.candidateBytes)} / ${bytes(renderMetrics.scan.totalBytes)}`} /><Diagnostic label="Fragment bytes avoided" value={percent(renderMetrics.scan.totalBytes - renderMetrics.scan.candidateBytes, renderMetrics.scan.totalBytes)} /><Diagnostic label="Row groups expected read" value={`${integer.format(renderMetrics.scan.expectedRowGroupCount)} / ${integer.format(renderMetrics.scan.candidateRowGroupCount)} candidate · ${integer.format(renderMetrics.scan.totalRowGroupCount)} total`} /><Diagnostic label="Row groups filtered" value={integer.format(renderMetrics.scan.totalRowGroupCount - renderMetrics.scan.expectedRowGroupCount)} /><Diagnostic label="Activity rows kept" value={`${integer.format(renderMetrics.scan.keptRowCount)} / ${integer.format(renderMetrics.scan.expectedRowCount)} expected-read rows`} /><Diagnostic label="Read-to-kept efficiency" value={percent(renderMetrics.scan.keptRowCount, renderMetrics.scan.expectedRowCount)} /><Diagnostic label="Visible routes" value={integer.format(renderMetrics.visibleCount)} /><Diagnostic label="Selected routes" value={integer.format(summary.activityCount)} /><Diagnostic label="Planned vertex estimate" value={`${integer.format(renderMetrics.plannedVertexEstimate)} / ${integer.format(renderMetrics.vertexBudget)} budget`} /><Diagnostic label="Raw vertex estimate" value={integer.format(renderMetrics.rawVertexEstimate)} /><Diagnostic label="Rendered vertices" value={integer.format(renderMetrics.vertexCount)} /><Diagnostic label="GeoArrow buffers" value={bytes(renderMetrics.geometryBufferBytes)} /><Diagnostic label="Coordinate objects created" value="0" /><Diagnostic label="Geometry query + transfer" value={`${renderMetrics.durationMs.toFixed(1)} ms`} /><Diagnostic label="Render cache" value={`${renderMetrics.cache.hit ? "hit" : "miss"} · ${bytes(renderMetrics.cache.bytes)} / ${bytes(renderMetrics.cache.budgetBytes)}`} /><Diagnostic label="Cached viewport batches" value={`${integer.format(renderMetrics.cache.entries)} · ${integer.format(renderMetrics.cache.evictions)} evicted`} /><Diagnostic label="Thickness control" value={`${tab.style.lineWidthScale.toFixed(2)}× · 0.15% viewport`} /><Diagnostic label="Route width" value={`${lineWidths.route.toFixed(2)} px`} /><Diagnostic label="Selected width" value={`${lineWidths.focus.toFixed(2)} px`} /><Diagnostic label="Heat vertices scored" value={integer.format(heat.sourceVertices)} /><Diagnostic label="Heat-colored routes" value={integer.format(heat.scores.size)} /><Diagnostic label="Heat proximity cells" value={integer.format(heat.cellCount)} /><Diagnostic label="Heat preparation" value={`${heat.durationMs.toFixed(1)} ms`} /><Diagnostic label="Heat UI slices" value={`${integer.format(heat.yieldCount + 1)} · ${heat.maxSliceMs.toFixed(1)} ms max`} /><Diagnostic label="Data view" value={tab.style.cleanEnabled ? "Clean derived view" : "Canonical raw view"} /><Diagnostic label="Basemap" value={tab.style.basemap} /></tbody></table><p>DuckDB transfers interleaved GeoArrow coordinate buffers to deck.gl without creating per-point JavaScript objects. Revisited and contained viewport batches remain in a bounded LRU cache (512 MiB desktop, 128 MiB mobile). Geometry layer inputs stay referentially stable while the camera moves, and heat scoring is recomputed between bounded main-thread slices. Fragment counts are exact for the worker query; row-group reads remain conservative estimates from compiler-recorded covering boxes.</p></section>}
    {aboutOpen && <section className="rich-stats about-drawer" aria-label="About this project"><header><img src={logoUrl} alt="" /><div><span className="eyebrow">ABOUT THIS PROJECT</span><h2>Your archive, at browser scale</h2></div><button aria-label="Close about this project" onClick={() => setAboutOpen(false)}>×</button></header><p className="about-lead">Squiggles is built for the larger GPX archive that becomes awkward to understand in experiences centered on individual activities or route planning.</p><div className="technology-flow" aria-label="Technology pipeline"><strong>Parquet</strong><span>→</span><strong>GeoArrow</strong><span>→</span><strong>DuckDB-Wasm</strong><span>→</span><strong>deck.gl</strong></div><h3>Millions of points, locally</h3><p>Columnar GeoParquet keeps the compiled archive compact. GeoArrow carries coordinates without a giant GeoJSON conversion. DuckDB runs SQL, summaries, viewport pruning, and detail lookup inside a browser worker, while deck.gl sends the chosen geometry to WebGL.</p><p>Together, those pieces let a user's own browser query and view many millions of recorded points. Dropping the same archive as thousands of individual GPX files into a route-planning import flow—Caltopo included—can overwhelm a workflow that was designed for a different job.</p><h3>What it is—and is not</h3><p>This is not a route planner, navigation system, training coach, or social feed. It is a storytelling tool: find the patterns across years of movement, revisit the places that shaped you, and share the resulting map.</p><a className="github-link" href="https://github.com/ljstrnadiii/squiggles" target="_blank" rel="noreferrer" aria-label="Squiggles on GitHub"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 .7a11.5 11.5 0 0 0-3.64 22.4c.58.1.79-.25.79-.56v-2.02c-3.22.7-3.9-1.37-3.9-1.37-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.71.08-.71 1.17.08 1.78 1.2 1.78 1.2 1.04 1.77 2.72 1.26 3.38.96.1-.75.4-1.26.74-1.55-2.57-.3-5.27-1.29-5.27-5.69 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.46.11-3.04 0 0 .97-.31 3.16 1.18a10.97 10.97 0 0 1 5.75 0c2.2-1.49 3.16-1.18 3.16-1.18.63 1.58.23 2.75.11 3.04.74.8 1.83 1.19 3.09 0 4.42-2.71 5.39-5.29 5.68.42.36.79 1.06.79 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .7Z" /></svg>View the project on GitHub</a><p className="privacy-note">Your activity SQL and rendering stay in the browser. Optional basemap tiles are the only runtime third-party requests.</p></section>}
  </main>;
}

function ElevationProfile({ samples, active, units, onHover }: { samples: ElevationSample[]; active: ElevationSample | null; units: UnitSystem; onHover: (sample: ElevationSample | null) => void }) {
  if (samples.length < 2) return <div className="profile-empty"><strong>Elevation profile</strong><span>No recorded elevation samples for this activity.</span></div>;
  const width = 420, height = 148, left = 8, right = 8, top = 10, bottom = 20;
  const maximumDistance = samples.at(-1)!.distanceM || 1;
  const minimumElevation = Math.min(...samples.map(sample => sample.elevationM));
  const maximumElevation = Math.max(...samples.map(sample => sample.elevationM));
  const elevationSpan = maximumElevation - minimumElevation || 1;
  const x = (sample: ElevationSample) => left + sample.distanceM / maximumDistance * (width - left - right);
  const y = (sample: ElevationSample) => height - bottom - (sample.elevationM - minimumElevation) / elevationSpan * (height - top - bottom);
  const points = samples.map(sample => `${x(sample)},${y(sample)}`).join(" ");
  function move(event: React.PointerEvent<SVGSVGElement>) {
    const ratio = Math.max(0, Math.min(1, (event.clientX - event.currentTarget.getBoundingClientRect().left) / event.currentTarget.clientWidth));
    const target = ratio * maximumDistance;
    let low = 0, high = samples.length - 1;
    while (low < high) { const middle = Math.floor((low + high) / 2); if (samples[middle].distanceM < target) low = middle + 1; else high = middle; }
    onHover(samples[low]);
  }
  const activeLabel = active
    ? `${integer.format(elevationValue(active.elevationM, units))} ${elevationUnit(units)} · ${distanceValue(active.distanceM, units).toFixed(1)} ${distanceUnit(units)}`
    : "Touch or hover to trace route";
  return <div className="profile"><div><strong>Elevation profile</strong><span>{activeLabel}</span></div><svg aria-label="Elevation profile chart" role="img" viewBox={`0 0 ${width} ${height}`} onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); move(event); }} onPointerMove={move} onPointerCancel={() => onHover(null)} onPointerLeave={event => { if (event.pointerType === "mouse") onHover(null); }}><defs><linearGradient id="profile-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={ELECTRIC_BLUE} stopOpacity=".38"/><stop offset="1" stopColor={ELECTRIC_BLUE} stopOpacity=".03"/></linearGradient></defs><line x1={left} x2={width - right} y1={top} y2={top} className="profile-grid"/><line x1={left} x2={width - right} y1={height - bottom} y2={height - bottom} className="profile-grid"/><polygon points={`${left},${height - bottom} ${points} ${width - right},${height - bottom}`} fill="url(#profile-fill)"/><polyline points={points} fill="none" stroke="#fff" strokeWidth="5" opacity=".9"/><polyline points={points} fill="none" stroke={ELECTRIC_BLUE} strokeWidth="2.5"/>{active && <><line x1={x(active)} x2={x(active)} y1={top} y2={height - bottom} className="profile-cursor"/><circle cx={x(active)} cy={y(active)} r="5" fill={ELECTRIC_BLUE} stroke="#fff" strokeWidth="2"/></>}<text x={left + 2} y={top + 11}>{integer.format(elevationValue(maximumElevation, units))} {elevationUnit(units)}</text><text x={left + 2} y={height - bottom - 5}>{integer.format(elevationValue(minimumElevation, units))} {elevationUnit(units)}</text><text x={width - right} y={height - 5} textAnchor="end">{distanceValue(maximumDistance, units).toFixed(1)} {distanceUnit(units)}</text></svg></div>;
}

function Stat({ value, label }: { value: string; label: string }) { return <div className="stat"><strong>{value}</strong><small>{label}</small></div>; }
function ScopeToggle({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) { return <label className="scope-toggle" title="Include only selected activities whose complete route bounds fit inside the unobscured map"><input type="checkbox" aria-label="Limit to activities contained in viewport" checked={checked} onChange={event => onChange(event.target.checked)} /><span>Viewport only</span></label>; }
function Stats({ summary, distance, elevation }: { summary: SummaryStats; distance: (meters: number) => string; elevation: (meters: number) => string }) { return <><div className="stats-grid"><Stat value={distance(summary.distanceM)} label="total distance" /><Stat value={distance(summary.maxDistanceM ?? 0)} label="longest" /><Stat value={distance(summary.activityCount ? summary.distanceM / summary.activityCount : 0)} label="average distance" /><Stat value={`${integer.format(summary.movingSeconds / 3600)} hr`} label="moving time" /><Stat value={`${integer.format(summary.elapsedSeconds / 3600)} hr`} label="elapsed time" /><Stat value={`${integer.format(summary.activityCount ? summary.movingSeconds / summary.activityCount / 60 : 0)} min`} label="average moving" /><Stat value={elevation(summary.elevationGainM)} label="elevation gain" /><Stat value={elevation(summary.elevationLossM)} label="elevation loss" /><Stat value={`${integer.format(summary.activeDays)} days`} label="active days" /><Stat value={integer.format(summary.droppedJumpPoints)} label="GPS spikes cleaned" /><Stat value={integer.format(summary.droppedElevationPoints)} label="elevation spikes cleaned" /></div><div className="sport-counts">{summary.sportCounts.map(item => <span key={item.sport}><strong>{integer.format(item.count)}</strong> {item.sport}</span>)}</div></>; }
function Diagnostic({ label, value }: { label: string; value: string }) { return <tr><th>{label}</th><td>{value}</td></tr>; }
function SortableHeader({ label, field, active, descending, onSort }: { label: string; field: TableSort; active: TableSort; descending: boolean; onSort: (field: TableSort) => void }) { return <th aria-sort={active === field ? (descending ? "descending" : "ascending") : "none"}><button aria-label={`Sort by ${label}`} onClick={() => onSort(field)}>{label}{active === field ? <span aria-hidden="true"> {descending ? "↓" : "↑"}</span> : null}</button></th>; }
declare global { interface Window { showDirectoryPicker(options?: { mode?: "read" | "readwrite" }): Promise<FileSystemDirectoryHandle> } }
