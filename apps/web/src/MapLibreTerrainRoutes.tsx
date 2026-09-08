import {useEffect, useMemo, useRef} from "react";
import * as maplibregl from "maplibre-gl";

import type {Basemap, BinaryRouteBatch, MapState} from "./contracts";

const DEM = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
const RTT_SIZE = 512;

type TileID = {wrap?: number; canonical: {x: number; y: number; z: number}};
type TerrainInput = maplibregl.CustomRenderMethodInput & {tileID: TileID | null};
type TerrainLayer = maplibregl.CustomLayerInterface & {renderToTile(gl: WebGL2RenderingContext, options: TerrainInput): void};
type SegmentBatch = {endpoints: Float32Array; colors: Uint8Array; segmentCount: number};

const rasterStyles: Record<Exclude<Basemap, "blank">, {tiles: string[]; attribution: string; maxzoom: number}> = {
  "carto-light": {tiles: ["https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png"], attribution: "© OpenStreetMap contributors © CARTO", maxzoom: 20},
  "carto-dark": {tiles: ["https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png"], attribution: "© OpenStreetMap contributors © CARTO", maxzoom: 20},
  streets: {tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], attribution: "© OpenStreetMap contributors", maxzoom: 19},
  topo: {tiles: ["https://tile.opentopomap.org/{z}/{x}/{y}.png"], attribution: "Map data © OpenStreetMap contributors, SRTM | Map style © OpenTopoMap (CC-BY-SA)", maxzoom: 17},
  imagery: {tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"], attribution: "Sources: Esri, Maxar, Earthstar Geographics, and the GIS User Community", maxzoom: 19},
};

function terrainStyle(basemap: Basemap, dark: boolean): maplibregl.StyleSpecification {
  const sources: maplibregl.StyleSpecification["sources"] = {terrain: {type: "raster-dem", tiles: [DEM], tileSize: 256, maxzoom: 14, encoding: "terrarium"}};
  const layers: maplibregl.LayerSpecification[] = [{id: "background", type: "background", paint: {"background-color": dark ? "#07100e" : "#edf2ef"}}];
  if (basemap !== "blank") {
    const source = rasterStyles[basemap];
    sources.basemap = {type: "raster", tiles: source.tiles, tileSize: 256, maxzoom: source.maxzoom, attribution: source.attribution};
    layers.push({id: "basemap", type: "raster", source: "basemap"});
  }
  return {version: 8, sources, layers, terrain: {source: "terrain", exaggeration: 1}};
}

function mercator(lng: number, lat: number): [number, number] {
  const sin = Math.sin(lat * Math.PI / 180);
  return [(lng + 180) / 360, 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)];
}

export function terrainSegmentBatch(batches: BinaryRouteBatch[], colors: Uint8Array[]): SegmentBatch {
  let segmentCount = 0;
  for (const batch of batches) for (let route = 0; route < batch.startIndices.length - 1; route++) segmentCount += Math.max(0, batch.startIndices[route + 1] - batch.startIndices[route] - 1);
  const endpoints = new Float32Array(segmentCount * 4);
  const segmentColors = new Uint8Array(segmentCount * 4);
  let segment = 0;
  batches.forEach((batch, batchIndex) => {
    const vertexColors = colors[batchIndex];
    for (let route = 0; route < batch.startIndices.length - 1; route++) {
      const start = batch.startIndices[route], end = batch.startIndices[route + 1];
      for (let point = start; point + 1 < end; point++) {
        const [x0, y0] = mercator(batch.positions[point * 2], batch.positions[point * 2 + 1]);
        const [x1, y1] = mercator(batch.positions[(point + 1) * 2], batch.positions[(point + 1) * 2 + 1]);
        endpoints.set([x0, y0, x1, y1], segment * 4);
        segmentColors.set(vertexColors.subarray(point * 4, point * 4 + 4), segment * 4);
        segment++;
      }
    }
  });
  return {endpoints, colors: segmentColors, segmentCount};
}

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source); gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "shader compile failed");
  return shader;
}

class BinaryTerrainLayer implements TerrainLayer {
  id = "squiggles-binary-terrain";
  type = "custom" as const;
  renderingMode = "2d" as const;
  private gl: WebGL2RenderingContext | null = null;
  private map: maplibregl.Map | null = null;
  private program: WebGLProgram | null = null;
  private endpointBuffer: WebGLBuffer | null = null;
  private colorBuffer: WebGLBuffer | null = null;
  private segmentCount = 0;
  private widthPx = 2;
  private pending: SegmentBatch = {endpoints: new Float32Array(), colors: new Uint8Array(), segmentCount: 0};

  setData(data: SegmentBatch, widthPx: number) {
    this.pending = data; this.segmentCount = data.segmentCount; this.widthPx = widthPx;
    if (this.gl) { this.upload(this.gl); this.map?.triggerRepaint(); }
  }

  onAdd(map: maplibregl.Map, gl: WebGL2RenderingContext) {
    this.gl = gl; this.map = map;
    const vs = compile(gl, gl.VERTEX_SHADER, `#version 300 es
precision highp float; uniform vec2 u_tile_origin; uniform float u_tile_scale; uniform float u_half_width; in vec2 a_start; in vec2 a_end; in vec4 a_color; out vec4 v_color;
void main(){bool atEnd=gl_VertexID==2||gl_VertexID==3||gl_VertexID==5; float side=(gl_VertexID==1||gl_VertexID==4||gl_VertexID==5)?1.0:-1.0; vec2 s=a_start*u_tile_scale-u_tile_origin; vec2 e=a_end*u_tile_scale-u_tile_origin; vec2 d=e-s; vec2 normal=vec2(-d.y,d.x)/max(length(d),1e-9); vec2 p=(atEnd?e:s)+normal*side*u_half_width; gl_Position=vec4(p.x*2.0-1.0,1.0-p.y*2.0,0.0,1.0); v_color=a_color;}`);
    const fs = compile(gl, gl.FRAGMENT_SHADER, `#version 300 es
precision highp float; in vec4 v_color; out vec4 fragColor; void main(){fragColor=v_color;}`);
    this.program = gl.createProgram()!; gl.attachShader(this.program, vs); gl.attachShader(this.program, fs); gl.linkProgram(this.program); gl.deleteShader(vs); gl.deleteShader(fs);
    this.endpointBuffer = gl.createBuffer(); this.colorBuffer = gl.createBuffer(); this.upload(gl); map.triggerRepaint();
  }

  private upload(gl: WebGL2RenderingContext) {
    if (!this.endpointBuffer || !this.colorBuffer) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.endpointBuffer); gl.bufferData(gl.ARRAY_BUFFER, this.pending.endpoints, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer); gl.bufferData(gl.ARRAY_BUFFER, this.pending.colors, gl.STATIC_DRAW);
  }

  render() {}
  renderToTile(gl: WebGL2RenderingContext, options: TerrainInput) {
    if (!this.program || !this.endpointBuffer || !this.colorBuffer || !options.tileID || !this.segmentCount) return;
    const tile = options.tileID, scale = 2 ** tile.canonical.z, ox = tile.canonical.x + (tile.wrap ?? 0) * scale;
    gl.useProgram(this.program); gl.uniform2f(gl.getUniformLocation(this.program, "u_tile_origin"), ox, tile.canonical.y); gl.uniform1f(gl.getUniformLocation(this.program, "u_tile_scale"), scale); gl.uniform1f(gl.getUniformLocation(this.program, "u_half_width"), this.widthPx / RTT_SIZE / 2);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.endpointBuffer);
    const s=gl.getAttribLocation(this.program,"a_start"), e=gl.getAttribLocation(this.program,"a_end"); gl.enableVertexAttribArray(s); gl.vertexAttribPointer(s,2,gl.FLOAT,false,16,0); gl.vertexAttribDivisor(s,1); gl.enableVertexAttribArray(e); gl.vertexAttribPointer(e,2,gl.FLOAT,false,16,8); gl.vertexAttribDivisor(e,1);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer); const c=gl.getAttribLocation(this.program,"a_color"); gl.enableVertexAttribArray(c); gl.vertexAttribPointer(c,4,gl.UNSIGNED_BYTE,true,4,0); gl.vertexAttribDivisor(c,1);
    gl.disable(gl.DEPTH_TEST); gl.depthMask(false); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA); gl.drawArraysInstanced(gl.TRIANGLES,0,6,this.segmentCount);
  }
  onRemove(_map: maplibregl.Map, gl: WebGL2RenderingContext) { this.gl=null; this.map=null; if(this.endpointBuffer)gl.deleteBuffer(this.endpointBuffer); if(this.colorBuffer)gl.deleteBuffer(this.colorBuffer); if(this.program)gl.deleteProgram(this.program); }
}

export function MapLibreTerrainRoutes({view, basemap, dark, batches, colors, widthPx, onView, onInteraction}: {view: MapState; basemap: Basemap; dark: boolean; batches: BinaryRouteBatch[]; colors: Uint8Array[]; widthPx: number; onView: (view: MapState) => void; onInteraction: (active: boolean) => void}) {
  const container = useRef<HTMLDivElement>(null), mapRef = useRef<maplibregl.Map | null>(null), layerRef = useRef<BinaryTerrainLayer | null>(null);
  const data = useMemo(() => terrainSegmentBatch(batches, colors), [batches, colors]);
  useEffect(() => {
    if (!container.current) return;
    const map = new maplibregl.Map({container: container.current, style: terrainStyle(basemap, dark), center: [view.longitude, view.latitude], zoom: view.zoom, pitch: 60, bearing: -20, attributionControl: {compact: true}, canvasContextAttributes: {antialias: true}});
    mapRef.current = map; const layer = new BinaryTerrainLayer(); layer.setData(data, widthPx); layerRef.current = layer;
    map.on("load", () => map.addLayer(layer as maplibregl.CustomLayerInterface));
    const start = () => onInteraction(true), end = () => {onInteraction(false); const center=map.getCenter(); onView({longitude:center.lng, latitude:center.lat, zoom:map.getZoom()});};
    map.on("movestart", start); map.on("moveend", end);
    return () => {map.remove(); mapRef.current=null; layerRef.current=null;};
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { layerRef.current?.setData(data, widthPx); }, [data, widthPx]);
  return <div className="maplibre-base" ref={container}/>;
}
