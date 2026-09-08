import * as maplibregl from 'maplibre-gl';
import {MercatorCoordinate, type CustomLayerInterface, type CustomRenderMethodInput} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

const status = document.getElementById('status')!;
status.textContent = 'module loaded · initializing terrain RTT custom layer…';
const fail = (reason: unknown) => {
  status.className = 'error';
  status.textContent = `startup error: ${reason instanceof Error ? reason.message : String(reason)}`;
};
window.addEventListener('error', event => fail(event.error ?? event.message));
window.addEventListener('unhandledrejection', event => fail(event.reason));

const DEM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const initialViewState = {longitude: -105.292, latitude: 39.985, zoom: 12.2, bearing: -24, pitch: 62};
const RTT_SIZE = 512;
const LINE_WIDTH_PX = 10;

const pathA = [
  [-105.3105,39.9780], [-105.3065,39.9800], [-105.3020,39.9830], [-105.2980,39.9860],
  [-105.2940,39.9890], [-105.2895,39.9910], [-105.2850,39.9920], [-105.2810,39.9910]
] as const;
const pathB = [
  [-105.3098,39.9785], [-105.3058,39.9805], [-105.3015,39.9835], [-105.2975,39.9865],
  [-105.2935,39.9895], [-105.2890,39.9915], [-105.2845,39.9925], [-105.2805,39.9915]
] as const;

type TileID = {
  wrap?: number;
  canonical: {x: number; y: number; z: number};
};

type TerrainRenderInput = CustomRenderMethodInput & {tileID: TileID | null};
type TerrainCustomLayer = CustomLayerInterface & {
  renderToTile(gl: WebGL2RenderingContext, options: TerrainRenderInput): void;
};

type SegmentBatch = {
  endpoints: Float32Array;
  colors: Float32Array;
  segmentCount: number;
};

function compileShader(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('could not create shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) ?? 'shader compile failed');
  }
  return shader;
}

function makeSegmentBatch() : SegmentBatch {
  const paths = [
    {path: pathA, color: [1, 0.05, 0.05, 1] as const},
    {path: pathB, color: [0.05, 0.35, 1, 1] as const},
  ];
  const segmentCount = paths.reduce((sum, {path}) => sum + path.length - 1, 0);
  const endpoints = new Float32Array(segmentCount * 4);
  const colors = new Float32Array(segmentCount * 4);
  let segment = 0;
  for (const {path, color} of paths) {
    for (let i = 0; i < path.length - 1; i++) {
      const start = MercatorCoordinate.fromLngLat(path[i]);
      const end = MercatorCoordinate.fromLngLat(path[i + 1]);
      endpoints.set([start.x, start.y, end.x, end.y], segment * 4);
      colors.set(color, segment * 4);
      segment += 1;
    }
  }
  return {endpoints, colors, segmentCount};
}

class BinaryTerrainRTTLayer implements TerrainCustomLayer {
  id = 'binary-terrain-rtt-test';
  type = 'custom' as const;
  renderingMode = '2d' as const;

  private program: WebGLProgram | null = null;
  private endpointBuffer: WebGLBuffer | null = null;
  private colorBuffer: WebGLBuffer | null = null;
  private segmentCount = 0;
  private renderedTiles = new Set<string>();

  onAdd(_map: maplibregl.Map, gl: WebGL2RenderingContext) {
    const vertexShader = compileShader(gl, gl.VERTEX_SHADER, `#version 300 es
      precision highp float;
      uniform vec2 u_tile_origin;
      uniform float u_tile_scale;
      uniform float u_half_width;
      in vec2 a_start;
      in vec2 a_end;
      in vec4 a_color;
      out vec4 v_color;

      void main() {
        bool atEnd = gl_VertexID == 2 || gl_VertexID == 3 || gl_VertexID == 5;
        float side = (gl_VertexID == 1 || gl_VertexID == 4 || gl_VertexID == 5) ? 1.0 : -1.0;

        vec2 start = a_start * u_tile_scale - u_tile_origin;
        vec2 end = a_end * u_tile_scale - u_tile_origin;
        vec2 direction = normalize(end - start);
        vec2 normal = vec2(-direction.y, direction.x);
        vec2 tile01 = (atEnd ? end : start) + normal * side * u_half_width;
        vec2 ndc = vec2(tile01.x * 2.0 - 1.0, 1.0 - tile01.y * 2.0);
        gl_Position = vec4(ndc, 0.0, 1.0);
        v_color = a_color;
      }
    `);
    const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, `#version 300 es
      precision highp float;
      in vec4 v_color;
      out vec4 fragColor;
      void main() {
        fragColor = v_color;
      }
    `);
    const program = gl.createProgram();
    if (!program) throw new Error('could not create WebGL program');
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) ?? 'program link failed');
    }
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    this.program = program;

    const batch = makeSegmentBatch();
    this.segmentCount = batch.segmentCount;

    this.endpointBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.endpointBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, batch.endpoints, gl.STATIC_DRAW);

    this.colorBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, batch.colors, gl.STATIC_DRAW);

    status.textContent = `binary buffers ready · ${this.segmentCount} GPU segments · waiting for terrain RTT…`;
  }

  render() {
    // Terrain-enabled rendering is handled exclusively by renderToTile in the fork.
  }

  renderToTile(gl: WebGL2RenderingContext, options: TerrainRenderInput) {
    if (!this.program || !this.endpointBuffer || !this.colorBuffer || !options.tileID) return;

    const tileID = options.tileID;
    const scale = 2 ** tileID.canonical.z;
    const originX = tileID.canonical.x + (tileID.wrap ?? 0) * scale;
    const originY = tileID.canonical.y;

    gl.useProgram(this.program);
    gl.uniform2f(gl.getUniformLocation(this.program, 'u_tile_origin'), originX, originY);
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_tile_scale'), scale);
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_half_width'), LINE_WIDTH_PX / RTT_SIZE / 2);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.endpointBuffer);
    const startLocation = gl.getAttribLocation(this.program, 'a_start');
    gl.enableVertexAttribArray(startLocation);
    gl.vertexAttribPointer(startLocation, 2, gl.FLOAT, false, 16, 0);
    gl.vertexAttribDivisor(startLocation, 1);

    const endLocation = gl.getAttribLocation(this.program, 'a_end');
    gl.enableVertexAttribArray(endLocation);
    gl.vertexAttribPointer(endLocation, 2, gl.FLOAT, false, 16, 8);
    gl.vertexAttribDivisor(endLocation, 1);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
    const colorLocation = gl.getAttribLocation(this.program, 'a_color');
    gl.enableVertexAttribArray(colorLocation);
    gl.vertexAttribPointer(colorLocation, 4, gl.FLOAT, false, 16, 0);
    gl.vertexAttribDivisor(colorLocation, 1);

    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.segmentCount);

    this.renderedTiles.add(`${tileID.canonical.z}/${tileID.canonical.x}/${tileID.canonical.y}/${tileID.wrap ?? 0}`);
    status.className = '';
    status.textContent = `ready · thick binary RTT → terrain drape · ${this.segmentCount} segments · ${this.renderedTiles.size} terrain tiles`;
  }

  onRemove(_map: maplibregl.Map, gl: WebGL2RenderingContext) {
    if (this.endpointBuffer) gl.deleteBuffer(this.endpointBuffer);
    if (this.colorBuffer) gl.deleteBuffer(this.colorBuffer);
    if (this.program) gl.deleteProgram(this.program);
  }
}

try {
  status.textContent = 'initializing MapLibre terrain…';
  const map = new maplibregl.Map({
    container: 'map',
    style: {
      version: 8,
      sources: {
        base: {
          type: 'raster',
          tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
          tileSize: 256,
          maxzoom: 19,
          attribution: '© OpenStreetMap contributors'
        },
        terrain: {type: 'raster-dem', tiles: [DEM], tileSize: 256, maxzoom: 14, encoding: 'terrarium'}
      },
      layers: [{id: 'base', type: 'raster', source: 'base'}],
      terrain: {source: 'terrain', exaggeration: 1}
    },
    center: [initialViewState.longitude, initialViewState.latitude],
    zoom: initialViewState.zoom,
    bearing: initialViewState.bearing,
    pitch: initialViewState.pitch,
    interactive: true,
    attributionControl: false,
    canvasContextAttributes: {antialias: true}
  });

  map.on('load', () => {
    status.textContent = 'MapLibre loaded · adding terrain RTT binary layer…';
    const layer = new BinaryTerrainRTTLayer();
    map.addLayer(layer as CustomLayerInterface);
    Object.assign(window, {__terrainSpike: {map, layer}});
  });
} catch (reason) {
  fail(reason);
}
