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
const EXTENT = 8192;

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

function makeSegments(path: readonly (readonly [number, number])[]) {
  const out = new Float32Array((path.length - 1) * 2 * 2);
  let offset = 0;
  for (let i = 0; i < path.length - 1; i++) {
    for (const point of [path[i], path[i + 1]]) {
      const merc = MercatorCoordinate.fromLngLat(point);
      out[offset++] = merc.x;
      out[offset++] = merc.y;
    }
  }
  return out;
}

class BinaryTerrainRTTLayer implements TerrainCustomLayer {
  id = 'binary-terrain-rtt-test';
  type = 'custom' as const;
  renderingMode = '2d' as const;

  private program: WebGLProgram | null = null;
  private positionBuffer: WebGLBuffer | null = null;
  private colorBuffer: WebGLBuffer | null = null;
  private vertexCount = 0;
  private renderedTiles = new Set<string>();

  onAdd(_map: maplibregl.Map, gl: WebGL2RenderingContext) {
    const vertexShader = compileShader(gl, gl.VERTEX_SHADER, `#version 300 es
      precision highp float;
      uniform mat4 u_matrix;
      uniform vec2 u_tile_origin;
      uniform float u_tile_scale;
      in vec2 a_position;
      in vec4 a_color;
      out vec4 v_color;
      void main() {
        vec2 tile_position = (a_position * u_tile_scale - u_tile_origin) * ${EXTENT}.0;
        gl_Position = u_matrix * vec4(tile_position, 0.0, 1.0);
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

    const red = makeSegments(pathA);
    const blue = makeSegments(pathB);
    const positions = new Float32Array(red.length + blue.length);
    positions.set(red);
    positions.set(blue, red.length);
    this.vertexCount = positions.length / 2;

    const colors = new Float32Array(this.vertexCount * 4);
    const redVertices = red.length / 2;
    for (let i = 0; i < this.vertexCount; i++) {
      colors.set(i < redVertices ? [1, 0.12, 0.18, 0.95] : [0.05, 0.55, 1, 0.95], i * 4);
    }

    this.positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    this.colorBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, colors, gl.STATIC_DRAW);

    status.textContent = `binary buffers ready · ${this.vertexCount} GPU vertices · waiting for terrain RTT…`;
  }

  render() {
    // When terrain is enabled the fork routes this layer through renderToTile.
  }

  renderToTile(gl: WebGL2RenderingContext, options: TerrainRenderInput) {
    if (!this.program || !this.positionBuffer || !this.colorBuffer || !options.tileID) return;

    const tileID = options.tileID;
    const projectionData = options.getProjectionData({tileID, applyTerrainMatrix: true});
    const scale = 2 ** tileID.canonical.z;
    const originX = tileID.canonical.x + (tileID.wrap ?? 0) * scale;
    const originY = tileID.canonical.y;

    gl.useProgram(this.program);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.program, 'u_matrix'), false, projectionData.mainMatrix);
    gl.uniform2f(gl.getUniformLocation(this.program, 'u_tile_origin'), originX, originY);
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_tile_scale'), scale);

    const positionLocation = gl.getAttribLocation(this.program, 'a_position');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    const colorLocation = gl.getAttribLocation(this.program, 'a_color');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
    gl.enableVertexAttribArray(colorLocation);
    gl.vertexAttribPointer(colorLocation, 4, gl.FLOAT, false, 0, 0);

    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.lineWidth(4);
    gl.drawArrays(gl.LINES, 0, this.vertexCount);

    this.renderedTiles.add(`${tileID.canonical.z}/${tileID.canonical.x}/${tileID.canonical.y}/${tileID.wrap ?? 0}`);
    status.className = '';
    status.textContent = `ready · terrain RTT drape · ${this.vertexCount} binary vertices · ${this.renderedTiles.size} terrain tiles · no elevation sampling`;
  }

  onRemove(_map: maplibregl.Map, gl: WebGL2RenderingContext) {
    if (this.positionBuffer) gl.deleteBuffer(this.positionBuffer);
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
