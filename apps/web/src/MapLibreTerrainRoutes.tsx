import {useEffect, useMemo, useRef, useState} from "react";
import * as maplibregl from "maplibre-gl";

import type {Basemap, BinaryRouteBatch, MapState, RouteMetadata, ViewportBounds, ViewportSize} from "./contracts";

const DEM = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
const RTT_SIZE = 512;
const MAX_DIAGNOSTIC_SEGMENT_METERS = 5_000;
const PICK_GRID_SCALE = 2 ** 15;
const PICK_TOLERANCE_PX = 14;

type TileID = {wrap?: number; canonical: {x: number; y: number; z: number}};
type TerrainInput = maplibregl.CustomRenderMethodInput & {tileID: TileID | null};
type TerrainLayer = maplibregl.CustomLayerInterface & {renderToTile(gl: WebGL2RenderingContext, options: TerrainInput): void};
export type SegmentBatch = {endpoints: Float32Array; colors: Uint8Array; owners: Uint32Array; activities: RouteMetadata[]; segmentCount: number; skippedLongSegments: number};
export type TerrainCamera = {view: MapState; bounds: ViewportBounds; size: ViewportSize};
export type TerrainPick = {activity: RouteMetadata; x: number; y: number};
type PickingIndex = {cells: Map<number, number[]>; data: SegmentBatch};

type PointData = {x: number; y: number} | null;

const rasterStyles: Record<Exclude<Basemap, "blank">, {tiles: string[]; attribution: string; maxzoom: number}> = {
  "carto-light": {tiles: ["https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png"], attribution: "© OpenStreetMap contributors © CARTO", maxzoom: 20},
  "carto-dark": {tiles: ["https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png"], attribution: "© OpenStreetMap contributors © CARTO", maxzoom: 20},
  streets: {tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], attribution: "© OpenStreetMap contributors", maxzoom: 19},
  topo: {tiles: ["https://tile.opentopomap.org/{z}/{x}/{y}.png"], attribution: "Map data © OpenStreetMap contributors, SRTM | Map style © OpenTopoMap (CC-BY-SA)", maxzoom: 17},
  imagery: {tiles: ["https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"], attribution: "Sources: Esri, Maxar, Earthstar Geographics, and the GIS User Community", maxzoom: 19},
};

function terrainStyle(basemap: Basemap, dark: boolean, exaggeration: number): maplibregl.StyleSpecification {
  const sources: maplibregl.StyleSpecification["sources"] = {terrain: {type: "raster-dem", tiles: [DEM], tileSize: 256, maxzoom: 14, encoding: "terrarium"}};
  const layers: maplibregl.LayerSpecification[] = [{id: "background", type: "background", paint: {"background-color": dark ? "#07100e" : "#edf2ef"}}];
  if (basemap !== "blank") {
    const source = rasterStyles[basemap];
    sources.basemap = {type: "raster", tiles: source.tiles, tileSize: 256, maxzoom: source.maxzoom, attribution: source.attribution};
    layers.push({id: "basemap", type: "raster", source: "basemap"});
  }
  return {version: 8, sources, layers, terrain: {source: "terrain", exaggeration}};
}

function mercator(lng: number, lat: number): [number, number] {
  const sin = Math.sin(lat * Math.PI / 180);
  return [(lng + 180) / 360, 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)];
}

function distanceMeters(lng0: number, lat0: number, lng1: number, lat1: number) {
  const radians = Math.PI / 180;
  const dLat = (lat1 - lat0) * radians;
  const dLng = (lng1 - lng0) * radians;
  const aLat = lat0 * radians;
  const bLat = lat1 * radians;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(aLat) * Math.cos(bLat) * Math.sin(dLng / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function terrainSegmentBatch(batches: BinaryRouteBatch[], colors: Uint8Array[], onlyActivityId?: string): SegmentBatch {
  let candidateCount = 0;
  const activities: RouteMetadata[] = [];
  const activityOffsets: number[] = [];
  for (const batch of batches) {
    if (batch.startIndices.length !== batch.segmentActivityIndices.length + 1) throw new Error(`Invalid BinaryRouteBatch: ${batch.startIndices.length} start indices for ${batch.segmentActivityIndices.length} segments`);
    activityOffsets.push(activities.length);
    activities.push(...batch.activities);
    for (let route = 0; route < batch.segmentActivityIndices.length; route++) {
      const activity = batch.activities[batch.segmentActivityIndices[route]];
      if (onlyActivityId && activity?.activityId !== onlyActivityId) continue;
      candidateCount += Math.max(0, batch.startIndices[route + 1] - batch.startIndices[route] - 1);
    }
  }
  const endpoints = new Float32Array(candidateCount * 4);
  const segmentColors = new Uint8Array(candidateCount * 4);
  const owners = new Uint32Array(candidateCount);
  let segment = 0, skippedLongSegments = 0;
  batches.forEach((batch, batchIndex) => {
    const vertexColors = colors[batchIndex];
    const activityOffset = activityOffsets[batchIndex];
    for (let route = 0; route < batch.segmentActivityIndices.length; route++) {
      const activityIndex = batch.segmentActivityIndices[route];
      const activity = batch.activities[activityIndex];
      if (onlyActivityId && activity?.activityId !== onlyActivityId) continue;
      const start = batch.startIndices[route], end = batch.startIndices[route + 1];
      for (let point = start; point + 1 < end; point++) {
        const lng0 = batch.positions[point * 2], lat0 = batch.positions[point * 2 + 1];
        const lng1 = batch.positions[(point + 1) * 2], lat1 = batch.positions[(point + 1) * 2 + 1];
        if (distanceMeters(lng0, lat0, lng1, lat1) > MAX_DIAGNOSTIC_SEGMENT_METERS) { skippedLongSegments++; continue; }
        const [x0, y0] = mercator(lng0, lat0), [x1, y1] = mercator(lng1, lat1);
        endpoints.set([x0, y0, x1, y1], segment * 4);
        segmentColors.set(vertexColors.subarray(point * 4, point * 4 + 4), segment * 4);
        owners[segment] = activityOffset + activityIndex;
        segment++;
      }
    }
  });
  return {endpoints: endpoints.subarray(0, segment * 4), colors: segmentColors.subarray(0, segment * 4), owners: owners.subarray(0, segment), activities, segmentCount: segment, skippedLongSegments};
}

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source); gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "shader compile failed");
  return shader;
}

class BinaryTerrainLayer implements TerrainLayer {
  id: string;
  type = "custom" as const;
  renderingMode = "2d" as const;
  private gl: WebGL2RenderingContext | null = null;
  private map: maplibregl.Map | null = null;
  private program: WebGLProgram | null = null;
  private endpointBuffer: WebGLBuffer | null = null;
  private colorBuffer: WebGLBuffer | null = null;
  private segmentCount = 0;
  private widthPx = 2;
  private pending: SegmentBatch = {endpoints: new Float32Array(), colors: new Uint8Array(), owners: new Uint32Array(), activities: [], segmentCount: 0, skippedLongSegments: 0};
  constructor(id = "squiggles-binary-terrain") { this.id = id; }
  setData(data: SegmentBatch, widthPx: number) { this.pending = data; this.segmentCount = data.segmentCount; this.widthPx = widthPx; if (this.gl) { this.upload(this.gl); this.map?.triggerRepaint(); } }
  onAdd(map: maplibregl.Map, gl: WebGL2RenderingContext) {
    this.gl = gl; this.map = map;
    const vs = compile(gl, gl.VERTEX_SHADER, `#version 300 es\nprecision highp float; uniform vec2 u_tile_origin; uniform float u_tile_scale; uniform float u_half_width; in vec2 a_start; in vec2 a_end; in vec4 a_color; out vec4 v_color;\nvoid main(){bool atEnd=gl_VertexID==2||gl_VertexID==3||gl_VertexID==5; float side=(gl_VertexID==1||gl_VertexID==4||gl_VertexID==5)?1.0:-1.0; vec2 s=a_start*u_tile_scale-u_tile_origin; vec2 e=a_end*u_tile_scale-u_tile_origin; vec2 d=e-s; vec2 normal=vec2(-d.y,d.x)/max(length(d),1e-9); vec2 p=(atEnd?e:s)+normal*side*u_half_width; gl_Position=vec4(p.x*2.0-1.0,1.0-p.y*2.0,0.0,1.0); v_color=a_color;}`);
    const fs = compile(gl, gl.FRAGMENT_SHADER, `#version 300 es\nprecision highp float; in vec4 v_color; out vec4 fragColor; void main(){fragColor=v_color;}`);
    this.program = gl.createProgram()!; gl.attachShader(this.program, vs); gl.attachShader(this.program, fs); gl.linkProgram(this.program); gl.deleteShader(vs); gl.deleteShader(fs);
    this.endpointBuffer = gl.createBuffer(); this.colorBuffer = gl.createBuffer(); this.upload(gl); map.triggerRepaint();
  }
  private upload(gl: WebGL2RenderingContext) { if (!this.endpointBuffer || !this.colorBuffer) return; gl.bindBuffer(gl.ARRAY_BUFFER, this.endpointBuffer); gl.bufferData(gl.ARRAY_BUFFER, this.pending.endpoints, gl.STATIC_DRAW); gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer); gl.bufferData(gl.ARRAY_BUFFER, this.pending.colors, gl.STATIC_DRAW); }
  render() {}
  renderToTile(gl: WebGL2RenderingContext, options: TerrainInput) {
    if (!this.program || !this.endpointBuffer || !this.colorBuffer || !options.tileID || !this.segmentCount) return;
    const tile = options.tileID, scale = 2 ** tile.canonical.z, ox = tile.canonical.x + (tile.wrap ?? 0) * scale;
    gl.useProgram(this.program); gl.uniform2f(gl.getUniformLocation(this.program, "u_tile_origin"), ox, tile.canonical.y); gl.uniform1f(gl.getUniformLocation(this.program, "u_tile_scale"), scale); gl.uniform1f(gl.getUniformLocation(this.program, "u_half_width"), this.widthPx / RTT_SIZE / 2);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.endpointBuffer);
    const s = gl.getAttribLocation(this.program, "a_start"), e = gl.getAttribLocation(this.program, "a_end"); gl.enableVertexAttribArray(s); gl.vertexAttribPointer(s, 2, gl.FLOAT, false, 16, 0); gl.vertexAttribDivisor(s, 1); gl.enableVertexAttribArray(e); gl.vertexAttribPointer(e, 2, gl.FLOAT, false, 16, 8); gl.vertexAttribDivisor(e, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer); const c = gl.getAttribLocation(this.program, "a_color"); gl.enableVertexAttribArray(c); gl.vertexAttribPointer(c, 4, gl.UNSIGNED_BYTE, true, 4, 0); gl.vertexAttribDivisor(c, 1);
    gl.disable(gl.DEPTH_TEST); gl.depthMask(false); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.segmentCount);
  }
  onRemove(_map: maplibregl.Map, gl: WebGL2RenderingContext) { this.gl = null; this.map = null; if (this.endpointBuffer) gl.deleteBuffer(this.endpointBuffer); if (this.colorBuffer) gl.deleteBuffer(this.colorBuffer); if (this.program) gl.deleteProgram(this.program); }
}

class BinaryTerrainPointLayer implements TerrainLayer {
  id = "squiggles-binary-terrain-profile-point";
  type = "custom" as const;
  renderingMode = "2d" as const;
  private map: maplibregl.Map | null = null;
  private program: WebGLProgram | null = null;
  private point: PointData = null;
  setPoint(point: PointData) { this.point = point; this.map?.triggerRepaint(); }
  onAdd(map: maplibregl.Map, gl: WebGL2RenderingContext) {
    this.map = map;
    const vs = compile(gl, gl.VERTEX_SHADER, `#version 300 es\nprecision highp float; uniform vec2 u_tile_origin; uniform float u_tile_scale; uniform vec2 u_point; void main(){vec2 p=u_point*u_tile_scale-u_tile_origin; gl_Position=vec4(p.x*2.0-1.0,1.0-p.y*2.0,0.0,1.0); gl_PointSize=14.0;}`);
    const fs = compile(gl, gl.FRAGMENT_SHADER, `#version 300 es\nprecision highp float; out vec4 fragColor; void main(){vec2 d=gl_PointCoord-vec2(.5); if(length(d)>.5) discard; fragColor=vec4(.15,.42,1.0,1.0);}`);
    this.program = gl.createProgram()!; gl.attachShader(this.program, vs); gl.attachShader(this.program, fs); gl.linkProgram(this.program); gl.deleteShader(vs); gl.deleteShader(fs);
  }
  render() {}
  renderToTile(gl: WebGL2RenderingContext, options: TerrainInput) {
    if (!this.program || !this.point || !options.tileID) return;
    const tile = options.tileID, scale = 2 ** tile.canonical.z, ox = tile.canonical.x + (tile.wrap ?? 0) * scale;
    gl.useProgram(this.program); gl.uniform2f(gl.getUniformLocation(this.program, "u_tile_origin"), ox, tile.canonical.y); gl.uniform1f(gl.getUniformLocation(this.program, "u_tile_scale"), scale); gl.uniform2f(gl.getUniformLocation(this.program, "u_point"), this.point.x, this.point.y);
    gl.disable(gl.DEPTH_TEST); gl.depthMask(false); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.drawArrays(gl.POINTS, 0, 1);
  }
  onRemove(_map: maplibregl.Map, gl: WebGL2RenderingContext) { this.map = null; if (this.program) gl.deleteProgram(this.program); }
}

function cameraSnapshot(map: maplibregl.Map): TerrainCamera {
  const center = map.getCenter(), bounds = map.getBounds(), canvas = map.getCanvas();
  return {view: {longitude: center.lng, latitude: center.lat, zoom: map.getZoom()}, bounds: [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()], size: {width: canvas.clientWidth, height: canvas.clientHeight}};
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

function pointAlong(data: SegmentBatch | null, ratio: number): PointData {
  if (!data?.segmentCount) return null;
  const lengths = new Float64Array(data.segmentCount); let total = 0;
  for (let i = 0; i < data.segmentCount; i++) { const o = i * 4; const dx = data.endpoints[o + 2] - data.endpoints[o], dy = data.endpoints[o + 3] - data.endpoints[o + 1]; const length = Math.hypot(dx, dy); lengths[i] = length; total += length; }
  let target = Math.max(0, Math.min(1, ratio)) * total;
  for (let i = 0; i < data.segmentCount; i++) { const length = lengths[i]; if (target <= length || i === data.segmentCount - 1) { const o = i * 4, t = length ? target / length : 0; return {x: data.endpoints[o] + (data.endpoints[o + 2] - data.endpoints[o]) * t, y: data.endpoints[o + 1] + (data.endpoints[o + 3] - data.endpoints[o + 1]) * t}; } target -= length; }
  return null;
}

export function MapLibreTerrainRoutes({view, basemap, dark, batches, colors, widthPx, highlightActivityId, isolateActivityId, onView, onInteraction, onHover, onClick, onBackgroundClick, onDiagnostics}: {
  view: MapState; basemap: Basemap; dark: boolean; batches: BinaryRouteBatch[]; colors: Uint8Array[]; widthPx: number; highlightActivityId?: string; isolateActivityId?: string; onView: (camera: TerrainCamera) => void; onInteraction: (active: boolean) => void; onHover?: (pick: TerrainPick | null) => void; onClick?: (activity: RouteMetadata) => void; onBackgroundClick?: () => void; onDiagnostics?: (data: SegmentBatch) => void;
}) {
  const container = useRef<HTMLDivElement>(null), mapRef = useRef<maplibregl.Map | null>(null), layerRef = useRef<BinaryTerrainLayer | null>(null), highlightLayerRef = useRef<BinaryTerrainLayer | null>(null), pointLayerRef = useRef<BinaryTerrainPointLayer | null>(null), indexRef = useRef<PickingIndex | null>(null);
  const callbacks = useRef({onView, onInteraction, onHover, onClick, onBackgroundClick}); callbacks.current = {onView, onInteraction, onHover, onClick, onBackgroundClick};
  const [threeD, setThreeD] = useState(true), [exaggeration, setExaggeration] = useState(1);
  const data = useMemo(() => terrainSegmentBatch(batches, colors, isolateActivityId), [batches, colors, isolateActivityId]);
  const highlightColors = useMemo(() => batches.map(batch => { const color = new Uint8Array(batch.positions.length / 2 * 4); color.fill(255); return color; }), [batches]);
  const highlightData = useMemo(() => highlightActivityId ? terrainSegmentBatch(batches, highlightColors, highlightActivityId) : null, [batches, highlightActivityId, highlightColors]);
  const index = useMemo(() => pickingIndex(data), [data]); indexRef.current = index;
  useEffect(() => { onDiagnostics?.(data); }, [data, onDiagnostics]);

  useEffect(() => {
    if (!container.current) return;
    const map = new maplibregl.Map({container: container.current, style: terrainStyle(basemap, dark, exaggeration), center: [view.longitude, view.latitude], zoom: view.zoom, pitch: 60, bearing: -20, attributionControl: {compact: true}, canvasContextAttributes: {antialias: true}});
    mapRef.current = map;
    const layer = new BinaryTerrainLayer(), highlightLayer = new BinaryTerrainLayer("squiggles-binary-terrain-highlight"), pointLayer = new BinaryTerrainPointLayer();
    layer.setData(data, widthPx); highlightLayer.setData(highlightData ?? {...data, segmentCount: 0}, widthPx * 1.8); layerRef.current = layer; highlightLayerRef.current = highlightLayer; pointLayerRef.current = pointLayer;
    const addLayers = () => { if (!map.getLayer(layer.id)) map.addLayer(layer as maplibregl.CustomLayerInterface); if (!map.getLayer(highlightLayer.id)) map.addLayer(highlightLayer as maplibregl.CustomLayerInterface); if (!map.getLayer(pointLayer.id)) map.addLayer(pointLayer as maplibregl.CustomLayerInterface); };
    map.on("load", addLayers); map.on("style.load", addLayers);
    const start = () => callbacks.current.onInteraction(true), end = () => { callbacks.current.onInteraction(false); callbacks.current.onView(cameraSnapshot(map)); };
    map.on("movestart", start); map.on("moveend", end);
    let frame = 0, pending: maplibregl.MapMouseEvent | null = null;
    const flushHover = () => { frame = 0; const event = pending; pending = null; if (!event) return; const value = indexRef.current ? pick(indexRef.current, map, event.lngLat.lng, event.lngLat.lat, event.point.x, event.point.y) : null; map.getCanvas().style.cursor = value ? "pointer" : ""; callbacks.current.onHover?.(value); };
    const move = (event: maplibregl.MapMouseEvent) => { pending = event; if (!frame) frame = requestAnimationFrame(flushHover); }, leave = () => { pending = null; if (frame) cancelAnimationFrame(frame); frame = 0; map.getCanvas().style.cursor = ""; callbacks.current.onHover?.(null); };
    const click = (event: maplibregl.MapMouseEvent) => { const value = indexRef.current ? pick(indexRef.current, map, event.lngLat.lng, event.lngLat.lat, event.point.x, event.point.y) : null; if (value) callbacks.current.onClick?.(value.activity); else callbacks.current.onBackgroundClick?.(); };
    map.on("mousemove", move); map.on("mouseout", leave); map.on("click", click);
    return () => { if (frame) cancelAnimationFrame(frame); map.remove(); mapRef.current = null; layerRef.current = null; highlightLayerRef.current = null; pointLayerRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { layerRef.current?.setData(data, widthPx); }, [data, widthPx]);
  useEffect(() => { highlightLayerRef.current?.setData(highlightData ?? {...data, segmentCount: 0}, widthPx * 1.8); }, [data, highlightData, widthPx]);
  useEffect(() => { const map = mapRef.current; if (!map) return; const center = map.getCenter(); if (Math.abs(center.lng - view.longitude) > 1e-7 || Math.abs(center.lat - view.latitude) > 1e-7 || Math.abs(map.getZoom() - view.zoom) > 1e-4) map.jumpTo({center: [view.longitude, view.latitude], zoom: view.zoom}); }, [view]);
  useEffect(() => { const map = mapRef.current; if (!map) return; map.setStyle(terrainStyle(basemap, dark, threeD ? exaggeration : 0)); }, [basemap, dark, exaggeration, threeD]);
  useEffect(() => { const map = mapRef.current; if (!map) return; map.easeTo({pitch: threeD ? 60 : 0, bearing: threeD ? -20 : 0, duration: 250}); }, [threeD]);
  useEffect(() => {
    const profile = document.querySelector<SVGSVGElement>(".detail .profile svg");
    if (!profile || !highlightData) { pointLayerRef.current?.setPoint(null); return; }
    const move = (event: PointerEvent) => { const rect = profile.getBoundingClientRect(); pointLayerRef.current?.setPoint(pointAlong(highlightData, (event.clientX - rect.left) / Math.max(rect.width, 1))); };
    const leave = () => pointLayerRef.current?.setPoint(null);
    profile.addEventListener("pointermove", move); profile.addEventListener("pointerleave", leave); profile.addEventListener("pointercancel", leave);
    return () => { profile.removeEventListener("pointermove", move); profile.removeEventListener("pointerleave", leave); profile.removeEventListener("pointercancel", leave); pointLayerRef.current?.setPoint(null); };
  }, [highlightData]);

  return <>
    <div className="maplibre-base" ref={container}/>
    <div style={{position: "absolute", right: 12, bottom: 40, zIndex: 12, display: "flex", gap: 8, alignItems: "center", padding: 8, borderRadius: 10, background: "rgba(7,16,14,.82)", color: "white", font: "12px system-ui,sans-serif", backdropFilter: "blur(8px)"}}>
      <button type="button" onClick={() => setThreeD(value => !value)} style={{minWidth: 54, height: 32, borderRadius: 7, border: "1px solid rgba(255,255,255,.25)", background: "rgba(255,255,255,.08)", color: "inherit"}}>{threeD ? "3D" : "2D"}</button>
      {threeD && <label style={{display: "flex", alignItems: "center", gap: 6}}>Exaggeration <input aria-label="Terrain exaggeration" type="range" min="0.25" max="3" step="0.05" value={exaggeration} onChange={event => setExaggeration(Number(event.target.value))}/><output>{exaggeration.toFixed(2)}×</output></label>}
    </div>
  </>;
}
