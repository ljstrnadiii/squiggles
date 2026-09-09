import { SegmentIndex } from "./segmentIndex";
import { perspectivePixelMeters } from "./perspectiveResolution";
import { applyTileDetail } from "./tileDetail";
import {useEffect, useMemo, useRef} from "react";
import * as maplibregl from "maplibre-gl";

import type {Basemap, BinaryRouteBatch, MapState, RouteMetadata, ViewportBounds, ViewportSize} from "./contracts";
import {rasterStyles, terrainSource} from "./mapSources";

const RTT_SIZE = 512;
const PICK_GRID_SCALE = 2 ** 15;
const PICK_TOLERANCE_PX = 14;

type TileID = {wrap?: number; canonical: {x: number; y: number; z: number}};
type TerrainInput = maplibregl.CustomRenderMethodInput & {tileID: TileID | null};
type TerrainLayer = maplibregl.CustomLayerInterface & {renderToTile(gl: WebGL2RenderingContext, options: TerrainInput): void};
export type SegmentBatch = {endpoints: Float32Array; colors: Uint8Array; widths?: Float32Array; owners: Uint32Array; activities: RouteMetadata[]; segmentCount: number};
export type TerrainCamera = {view: MapState; bounds: ViewportBounds; size: ViewportSize};
export type TerrainPick = {activity: RouteMetadata; x: number; y: number};
type PickingIndex = {cells: Map<number, number[]>; data: SegmentBatch};

function terrainStyle(basemap: Basemap, dark: boolean, exaggeration: number): maplibregl.StyleSpecification {
  const sources: maplibregl.StyleSpecification["sources"] = {terrain: terrainSource};
  const layers: maplibregl.LayerSpecification[] = [{id: "background", type: "background", paint: {"background-color": dark ? "#07100e" : "#edf2ef"}}];
  if (basemap !== "blank") {
    const source = rasterStyles[basemap];
    sources.basemap = {type: "raster", tiles: source.tiles, tileSize: source.tileSize, maxzoom: source.maxzoom, attribution: source.attribution};
    layers.push({id: "basemap", type: "raster", source: "basemap"});
  }
  return {version: 8, sources, layers, terrain: {source: "terrain", exaggeration}};
}

function mercator(lng: number, rawLat: number): [number, number] {
  const lat = Math.max(-85.051129, Math.min(85.051129, rawLat));
  const sin = Math.sin(lat * Math.PI / 180);
  return [(lng + 180) / 360, 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)];
}

export function terrainSegmentBatch(batches: BinaryRouteBatch[], colors: Uint8Array[], onlyActivityId?: string, priorityActivityId?: string, highlight?: { activity: RouteMetadata; path: [number, number][] }): SegmentBatch {
  let candidateCount = 0;
  const activities: RouteMetadata[] = [];
  const activityOffsets: number[] = [];
  for (const batch of batches) {
    if (batch.startIndices.length !== batch.segmentActivityIndices.length + 1) throw new Error(`Invalid BinaryRouteBatch: ${batch.startIndices.length} start indices for ${batch.segmentActivityIndices.length} segments`);
    activityOffsets.push(activities.length);
    activities.push(...batch.activities);
    for (let route = 0; route < batch.segmentActivityIndices.length; route += 1) {
      const activity = batch.activities[batch.segmentActivityIndices[route]];
      if (onlyActivityId && activity?.activityId !== onlyActivityId) continue;
      candidateCount += Math.max(0, batch.startIndices[route + 1] - batch.startIndices[route] - 1);
    }
  }
  if (highlight && (!onlyActivityId || onlyActivityId === highlight.activity.activityId)) candidateCount += Math.max(0, highlight.path.length - 1);
  const endpoints = new Float32Array(candidateCount * 4);
  const segmentColors = new Uint8Array(candidateCount * 4);
  const widths = new Float32Array(candidateCount);
  const owners = new Uint32Array(candidateCount);
  let segment = 0;
  for (const priority of [false, true]) {
    batches.forEach((batch, batchIndex) => {
      const vertexColors = colors[batchIndex];
      const activityOffset = activityOffsets[batchIndex];
      for (let route = 0; route < batch.segmentActivityIndices.length; route += 1) {
        const activityIndex = batch.segmentActivityIndices[route];
        const activity = batch.activities[activityIndex];
        if (onlyActivityId && activity?.activityId !== onlyActivityId) continue;
        const isPriority = activity?.activityId === priorityActivityId;
        if (priorityActivityId && isPriority !== priority) continue;
        if (!priorityActivityId && priority) continue;
        const start = batch.startIndices[route], end = batch.startIndices[route + 1];
        for (let point = start; point + 1 < end; point++) {
          const lng0 = batch.positions[point * 2], lat0 = batch.positions[point * 2 + 1];
          const lng1 = batch.positions[(point + 1) * 2], lat1 = batch.positions[(point + 1) * 2 + 1];
          if (!Number.isFinite(lng0) || !Number.isFinite(lat0) || !Number.isFinite(lng1) || !Number.isFinite(lat1)) continue;
          const [x0, y0] = mercator(lng0, lat0), [x1, y1] = mercator(lng1, lat1);
          endpoints.set([x0, y0, x1, y1], segment * 4);
          segmentColors.set(vertexColors.subarray(point * 4, point * 4 + 4), segment * 4);
          widths[segment] = isPriority ? 1.35 : 1;
          owners[segment] = activityOffset + activityIndex;
          segment++;
        }
      }
    });
  }
  if (highlight && (!onlyActivityId || onlyActivityId === highlight.activity.activityId)) {
    const owner = activities.length;
    activities.push(highlight.activity);
    const fallback = (() => {
      for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
        const batch = batches[batchIndex];
        for (let route = 0; route < batch.segmentActivityIndices.length; route += 1) {
          const activity = batch.activities[batch.segmentActivityIndices[route]];
          if (activity?.activityId !== highlight.activity.activityId) continue;
          const start = batch.startIndices[route];
          return colors[batchIndex]?.subarray(start * 4, start * 4 + 4) ?? new Uint8Array([255, 255, 255, 255]);
        }
      }
      return new Uint8Array([255, 255, 255, 255]);
    })();
    for (let point = 0; point + 1 < highlight.path.length; point += 1) {
      const [x0, y0] = mercator(...highlight.path[point]);
      const [x1, y1] = mercator(...highlight.path[point + 1]);
      endpoints.set([x0, y0, x1, y1], segment * 4);
      segmentColors.set(fallback, segment * 4);
      widths[segment] = 1.35;
      owners[segment] = owner;
      segment += 1;
    }
  }
  return {endpoints: endpoints.subarray(0, segment * 4), colors: segmentColors.subarray(0, segment * 4), widths: widths.subarray(0, segment), owners: owners.subarray(0, segment), activities, segmentCount: segment};
}

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source); gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "shader compile failed");
  return shader;
}

export class BinaryTerrainLayer implements TerrainLayer {
  id: string;
  type = "custom" as const;
  renderingMode = "2d" as const;
  private gl: WebGL2RenderingContext | null = null;
  private map: maplibregl.Map | null = null;
  private program: WebGLProgram | null = null;
  private spatial = new SegmentIndex(new Float32Array());
  private tiles = new Map<string, { endpoints: WebGLBuffer; colors: WebGLBuffer; widths: WebGLBuffer; count: number; bytes: number }>();
  private tileBytes = 0;
  private submissions = new Map<string, number>();
  diagnostics() { return { loadedSegments: this.segmentCount, submittedSegments: [...this.submissions.values()].reduce((a, b) => a + b, 0), tileCount: this.submissions.size }; }
  private clearTiles() {
    if (this.gl) for (const tile of this.tiles.values()) { this.gl.deleteBuffer(tile.endpoints); this.gl.deleteBuffer(tile.colors); this.gl.deleteBuffer(tile.widths); }
    this.tiles.clear(); this.tileBytes = 0; this.submissions.clear();
  }
  private segmentCount = 0;
  private widthPx = 2;
  private pending: SegmentBatch = {endpoints: new Float32Array(), colors: new Uint8Array(), widths: new Float32Array(), owners: new Uint32Array(), activities: [], segmentCount: 0};
  constructor(id = "squiggles-binary-terrain") { this.id = id; }
  setData(data: SegmentBatch, widthPx: number) { this.pending = data; this.segmentCount = data.segmentCount; this.widthPx = widthPx; this.spatial = new SegmentIndex(data.endpoints); this.clearTiles(); this.map?.triggerRepaint(); }
  onAdd(map: maplibregl.Map, gl: WebGL2RenderingContext) {
    this.gl = gl; this.map = map;
    const vs = compile(gl, gl.VERTEX_SHADER, `#version 300 es\nprecision highp float; uniform vec2 u_tile_origin; uniform float u_tile_scale; uniform float u_half_width; in vec2 a_start; in vec2 a_end; in vec4 a_color; in float a_width; out vec4 v_color;\nvoid main(){bool atEnd=gl_VertexID==2||gl_VertexID==3||gl_VertexID==5; float side=(gl_VertexID==1||gl_VertexID==4||gl_VertexID==5)?1.0:-1.0; vec2 s=a_start*u_tile_scale-u_tile_origin; vec2 e=a_end*u_tile_scale-u_tile_origin; vec2 d=e-s; vec2 normal=vec2(-d.y,d.x)/max(length(d),1e-9); vec2 p=(atEnd?e:s)+normal*side*u_half_width*a_width; gl_Position=vec4(p.x*2.0-1.0,1.0-p.y*2.0,0.0,1.0); v_color=a_color;}`);
    const fs = compile(gl, gl.FRAGMENT_SHADER, `#version 300 es\nprecision highp float; in vec4 v_color; out vec4 fragColor; void main(){fragColor=v_color;}`);
    this.program = gl.createProgram()!; gl.attachShader(this.program, vs); gl.attachShader(this.program, fs); gl.linkProgram(this.program); gl.deleteShader(vs); gl.deleteShader(fs);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(this.program) ?? "program link failed");
    map.triggerRepaint();
  }
  render() {}
  renderToTile(gl: WebGL2RenderingContext, options: TerrainInput) {
    if (!this.program || !options.tileID || !this.segmentCount) return;
    const tile = options.tileID, scale = 2 ** tile.canonical.z, ox = tile.canonical.x;
    const key = `${tile.canonical.z}/${tile.canonical.x}/${tile.canonical.y}`;
    let buffers = this.tiles.get(key);
    if (!buffers) {
      const margin = this.widthPx / RTT_SIZE / scale;
      const ids = this.spatial.query([ox / scale - margin, tile.canonical.y / scale - margin, (ox + 1) / scale + margin, (tile.canonical.y + 1) / scale + margin]);
      const endpoints = new Float32Array(ids.length * 4), colors = new Uint8Array(ids.length * 4), widths = new Float32Array(ids.length);
      ids.forEach((id, i) => { endpoints.set(this.pending.endpoints.subarray(id * 4, id * 4 + 4), i * 4); colors.set(this.pending.colors.subarray(id * 4, id * 4 + 4), i * 4); widths[i] = this.pending.widths?.[id] ?? 1; });
      const bytes = endpoints.byteLength + colors.byteLength + widths.byteLength;
      while (this.tileBytes + bytes > 32 * 1024 ** 2 && this.tiles.size) {
        const [oldKey, old] = this.tiles.entries().next().value!;
        gl.deleteBuffer(old.endpoints); gl.deleteBuffer(old.colors); gl.deleteBuffer(old.widths); this.tiles.delete(oldKey); this.tileBytes -= old.bytes;
      }
      buffers = { endpoints: gl.createBuffer()!, colors: gl.createBuffer()!, widths: gl.createBuffer()!, count: ids.length, bytes };
      gl.bindBuffer(gl.ARRAY_BUFFER, buffers.endpoints); gl.bufferData(gl.ARRAY_BUFFER, endpoints, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffers.colors); gl.bufferData(gl.ARRAY_BUFFER, colors, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffers.widths); gl.bufferData(gl.ARRAY_BUFFER, widths, gl.STATIC_DRAW);
      this.tiles.set(key, buffers); this.tileBytes += bytes;
    } else { this.tiles.delete(key); this.tiles.set(key, buffers); }
    this.submissions.set(key, buffers.count);
    if (!buffers.count) return;
    gl.useProgram(this.program); gl.uniform2f(gl.getUniformLocation(this.program, "u_tile_origin"), ox, tile.canonical.y); gl.uniform1f(gl.getUniformLocation(this.program, "u_tile_scale"), scale); gl.uniform1f(gl.getUniformLocation(this.program, "u_half_width"), this.widthPx / RTT_SIZE / 2);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.endpoints);
    const s = gl.getAttribLocation(this.program, "a_start"), e = gl.getAttribLocation(this.program, "a_end"); gl.enableVertexAttribArray(s); gl.vertexAttribPointer(s, 2, gl.FLOAT, false, 16, 0); gl.vertexAttribDivisor(s, 1); gl.enableVertexAttribArray(e); gl.vertexAttribPointer(e, 2, gl.FLOAT, false, 16, 8); gl.vertexAttribDivisor(e, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.colors); const c = gl.getAttribLocation(this.program, "a_color"); gl.enableVertexAttribArray(c); gl.vertexAttribPointer(c, 4, gl.UNSIGNED_BYTE, true, 4, 0); gl.vertexAttribDivisor(c, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.widths); const w = gl.getAttribLocation(this.program, "a_width"); gl.enableVertexAttribArray(w); gl.vertexAttribPointer(w, 1, gl.FLOAT, false, 4, 0); gl.vertexAttribDivisor(w, 1);
    gl.disable(gl.DEPTH_TEST); gl.depthMask(false); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, buffers.count);
  }
  onRemove(_map: maplibregl.Map, gl: WebGL2RenderingContext) { this.clearTiles(); this.gl = null; this.map = null; if (this.program) gl.deleteProgram(this.program); }
}

function cameraSnapshot(map: maplibregl.Map): TerrainCamera {
  const center = map.getCenter(), bounds = map.getBounds(), canvas = map.getCanvas();
  return {view: {longitude: center.lng, latitude: center.lat, zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing()}, bounds: [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()], size: {width: canvas.clientWidth, height: canvas.clientHeight, pixelMeters: perspectivePixelMeters(canvas.clientWidth, canvas.clientHeight, point => map.unproject(point)), threeD: true}};
}

function cellKey(x: number, y: number) { return y * PICK_GRID_SCALE + x; }
function pickingIndex(data: SegmentBatch): PickingIndex {
  const cells = new Map<number, number[]>();
  for (let segment = 0; segment < data.segmentCount; segment++) {
    const o = segment * 4, x0 = data.endpoints[o], y0 = data.endpoints[o + 1], x1 = data.endpoints[o + 2], y1 = data.endpoints[o + 3];
    const minX = Math.max(0, Math.floor(Math.min(x0, x1) * PICK_GRID_SCALE)), maxX = Math.min(PICK_GRID_SCALE - 1, Math.floor(Math.max(x0, x1) * PICK_GRID_SCALE));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1) * PICK_GRID_SCALE)), maxY = Math.min(PICK_GRID_SCALE - 1, Math.floor(Math.max(y0, y1) * PICK_GRID_SCALE));
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) { const key = cellKey(x, y), values = cells.get(key); if (values) values.push(segment); else cells.set(key, [segment]); }
  }
  return {cells, data};
}

function pointSegmentDistance(px: number, py: number, x0: number, y0: number, x1: number, y1: number) {
  const dx = x1 - x0, dy = y1 - y0, length2 = dx * dx + dy * dy;
  if (!length2) return Math.hypot(px - x0, py - y0);
  const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / length2));
  return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
}

function pick(index: PickingIndex, map: maplibregl.Map, lng: number, lat: number, x: number, y: number): TerrainPick | null {
  const [mx, my] = mercator(lng, lat), tolerance = PICK_TOLERANCE_PX / (512 * 2 ** map.getZoom()) * 2.5, radius = Math.max(1, Math.ceil(tolerance * PICK_GRID_SCALE));
  const cx = Math.floor(mx * PICK_GRID_SCALE), cy = Math.floor(my * PICK_GRID_SCALE); let best = -1, bestDistance = tolerance; const seen = new Set<number>();
  for (let gy = cy - radius; gy <= cy + radius; gy++) for (let gx = cx - radius; gx <= cx + radius; gx++) {
    const candidates = index.cells.get(cellKey(gx, gy)); if (!candidates) continue;
    for (const segment of candidates) { if (seen.has(segment)) continue; seen.add(segment); const o = segment * 4; const d = pointSegmentDistance(mx, my, index.data.endpoints[o], index.data.endpoints[o + 1], index.data.endpoints[o + 2], index.data.endpoints[o + 3]); if (d < bestDistance) { bestDistance = d; best = segment; } }
  }
  if (best < 0) return null; const activity = index.data.activities[index.data.owners[best]]; return activity ? {activity, x, y} : null;
}

export function MapLibreTerrainRoutes({view, basemap, dark, exaggeration, batches, colors, widthPx, imageryDetail = 0, terrainDetail = 0, onDiagnostics, profilePosition, highlightActivityId, isolateActivityId, onView, onInteraction, onHover, onClick, onBackgroundClick}: {
  view: MapState; basemap: Basemap; dark: boolean; exaggeration: number; batches: BinaryRouteBatch[]; colors: Uint8Array[]; widthPx: number; imageryDetail?: number; terrainDetail?: number; onDiagnostics?: (metrics: { loadedSegments: number; submittedSegments: number; tileCount: number }) => void; profilePosition?: [number, number]; highlightActivityId?: string; isolateActivityId?: string; onView: (camera: TerrainCamera) => void; onInteraction: (active: boolean) => void; onHover?: (pick: TerrainPick | null) => void; onClick?: (activity: RouteMetadata) => void; onBackgroundClick?: () => void;
}) {
  const container = useRef<HTMLDivElement>(null), mapRef = useRef<maplibregl.Map | null>(null), layerRef = useRef<BinaryTerrainLayer | null>(null), profileMarkerRef = useRef<maplibregl.Marker | null>(null), indexRef = useRef<PickingIndex | null>(null), interactingRef = useRef(false);
  const appliedStyleRef = useRef(`${basemap}:${dark}`);
  const callbacks = useRef({onDiagnostics, onView, onInteraction, onHover, onClick, onBackgroundClick}); callbacks.current = {onDiagnostics, onView, onInteraction, onHover, onClick, onBackgroundClick};
  const detailRef = useRef({ imageryDetail, terrainDetail }); detailRef.current = { imageryDetail, terrainDetail };
  const exaggerationRef = useRef(exaggeration); exaggerationRef.current = exaggeration;
  const data = useMemo(() => terrainSegmentBatch(batches, colors, isolateActivityId, highlightActivityId), [batches, colors, highlightActivityId, isolateActivityId]);
  const index = useMemo(() => pickingIndex(data), [data]); indexRef.current = index;

  useEffect(() => {
    if (!container.current) return;
    const map = new maplibregl.Map({container: container.current, style: terrainStyle(basemap, dark, exaggerationRef.current), center: [view.longitude, view.latitude], zoom: view.zoom, pitch: view.pitch, bearing: view.bearing, maxPitch: 85, attributionControl: {compact: true}, canvasContextAttributes: {antialias: true}});
    mapRef.current = map;
    const layer = new BinaryTerrainLayer();
    layer.setData(data, widthPx); layerRef.current = layer;
    const addLayers = () => {
      if (!map.getLayer(layer.id)) map.addLayer(layer as maplibregl.CustomLayerInterface);
      applyTileDetail(map, "basemap", detailRef.current.imageryDetail);
      applyTileDetail(map, "terrain", detailRef.current.terrainDetail);
    };
    const load = () => { addLayers(); callbacks.current.onView(cameraSnapshot(map)); };
    map.on("idle", () => callbacks.current.onDiagnostics?.(layer.diagnostics()));
    map.on("load", load); map.on("style.load", addLayers);
    const start = () => { interactingRef.current = true; map.getCanvas().style.cursor = ""; callbacks.current.onHover?.(null); callbacks.current.onInteraction(true); };
    const end = () => { interactingRef.current = false; callbacks.current.onInteraction(false); callbacks.current.onView(cameraSnapshot(map)); };
    map.on("movestart", start); map.on("moveend", end);
    let frame = 0, pending: maplibregl.MapMouseEvent | null = null;
    const flushHover = () => { frame = 0; const event = pending; pending = null; if (!event || interactingRef.current) return; const value = indexRef.current ? pick(indexRef.current, map, event.lngLat.lng, event.lngLat.lat, event.point.x, event.point.y) : null; map.getCanvas().style.cursor = value ? "pointer" : ""; callbacks.current.onHover?.(value); };
    const move = (event: maplibregl.MapMouseEvent) => { if (interactingRef.current) return; pending = event; if (!frame) frame = requestAnimationFrame(flushHover); };
    const leave = () => { pending = null; if (frame) cancelAnimationFrame(frame); frame = 0; map.getCanvas().style.cursor = ""; callbacks.current.onHover?.(null); };
    const click = (event: maplibregl.MapMouseEvent) => { const value = indexRef.current ? pick(indexRef.current, map, event.lngLat.lng, event.lngLat.lat, event.point.x, event.point.y) : null; if (value) callbacks.current.onClick?.(value.activity); else callbacks.current.onBackgroundClick?.(); };
    map.on("mousemove", move); map.on("mouseout", leave); map.on("click", click);
    return () => { if (frame) cancelAnimationFrame(frame); profileMarkerRef.current?.remove(); profileMarkerRef.current = null; map.remove(); mapRef.current = null; layerRef.current = null; };
  // Initial map construction intentionally happens only once; prop updates are applied by effects below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded()) return;
    applyTileDetail(map, "basemap", imageryDetail);
    applyTileDetail(map, "terrain", terrainDetail);
  }, [imageryDetail, terrainDetail]);

  useEffect(() => { layerRef.current?.setData(data, widthPx); }, [data, widthPx]);
  useEffect(() => { const map = mapRef.current; if (!map) return; const center = map.getCenter(); if (Math.abs(center.lng - view.longitude) > 1e-7 || Math.abs(center.lat - view.latitude) > 1e-7 || Math.abs(map.getZoom() - view.zoom) > 1e-4 || Math.abs(map.getPitch() - view.pitch) > 1e-4 || Math.abs(map.getBearing() - view.bearing) > 1e-4) map.jumpTo({center: [view.longitude, view.latitude], zoom: view.zoom, pitch: view.pitch, bearing: view.bearing}); }, [view]);
  useEffect(() => {
    const key = `${basemap}:${dark}`;
    if (appliedStyleRef.current === key) return;
    appliedStyleRef.current = key;
    mapRef.current?.setStyle(terrainStyle(basemap, dark, exaggerationRef.current));
  }, [basemap, dark]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const updateTerrain = () => map.setTerrain({source: "terrain", exaggeration});
    if (map.isStyleLoaded()) updateTerrain();
    map.on("style.load", updateTerrain);
    return () => { map.off("style.load", updateTerrain); };
  }, [exaggeration]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!profilePosition) {
      profileMarkerRef.current?.remove();
      profileMarkerRef.current = null;
      return;
    }
    if (!profileMarkerRef.current) {
      const element = document.createElement("div");
      element.className = "terrain-profile-marker";
      element.setAttribute("role", "img");
      element.setAttribute("aria-label", "Elevation profile position");
      profileMarkerRef.current = new maplibregl.Marker({ element, anchor: "center", opacityWhenCovered: 0, subpixelPositioning: true })
        .setLngLat(profilePosition).addTo(map);
    } else {
      profileMarkerRef.current.setLngLat(profilePosition);
    }
  }, [profilePosition]);

  return <div className="maplibre-base" ref={container}/>;
}
