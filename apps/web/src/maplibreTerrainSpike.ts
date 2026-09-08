const status = document.getElementById('status')!;
const fail = (reason: unknown) => {
  status.className = 'error';
  status.textContent = `startup error: ${reason instanceof Error ? reason.message : String(reason)}`;
};
window.addEventListener('error', event => fail(event.error ?? event.message));
window.addEventListener('unhandledrejection', event => fail(event.reason));

async function main() {
  try {
    status.textContent = 'importing MapLibre…';
    const [{default: maplibregl}] = await Promise.all([
      import('maplibre-gl'),
      import('maplibre-gl/dist/maplibre-gl.css')
    ]);

    status.textContent = 'MapLibre loaded · importing deck core…';
    const [{Deck, MapView}, {PathLayer}] = await Promise.all([
      import('@deck.gl/core'),
      import('@deck.gl/layers')
    ]);

    status.textContent = 'deck core loaded · importing TerrainExtension…';
    const {_TerrainExtension: TerrainExtension} = await import('@deck.gl/extensions');

    status.textContent = 'TerrainExtension loaded · importing TerrainLayer…';
    const {TerrainLayer} = await import('@deck.gl/geo-layers');

    status.textContent = 'all modules loaded · initializing terrain…';

    const DEM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
    const decoder = {rScaler: 256, gScaler: 1, bScaler: 1 / 256, offset: -32768};
    const initialViewState = {longitude: -105.292, latitude: 39.985, zoom: 12.2, bearing: -24, pitch: 62};

    const map = new maplibregl.Map({
      container: 'map',
      style: {
        version: 8,
        sources: {
          base: {type: 'raster', tiles: ['https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap contributors © CARTO'},
          terrain: {type: 'raster-dem', tiles: [DEM], tileSize: 256, maxzoom: 14, encoding: 'terrarium'}
        },
        layers: [{id: 'base', type: 'raster', source: 'base'}],
        terrain: {source: 'terrain', exaggeration: 1}
      },
      center: [initialViewState.longitude, initialViewState.latitude],
      zoom: initialViewState.zoom,
      bearing: initialViewState.bearing,
      pitch: initialViewState.pitch,
      interactive: false,
      attributionControl: false,
      canvasContextAttributes: {antialias: true}
    });

    status.textContent = 'MapLibre terrain created · building binary routes…';

    const positions = new Float64Array([
      -105.3105,39.9780, -105.3065,39.9800, -105.3020,39.9830, -105.2980,39.9860,
      -105.2940,39.9890, -105.2895,39.9910, -105.2850,39.9920, -105.2810,39.9910,
      -105.3098,39.9785, -105.3058,39.9805, -105.3015,39.9835, -105.2975,39.9865,
      -105.2935,39.9895, -105.2890,39.9915, -105.2845,39.9925, -105.2805,39.9915
    ]);
    const startIndices = new Uint32Array([0, 8, 16]);
    const colors = new Uint8Array(16 * 4);
    for (let i = 0; i < 8; i++) colors.set([255, 62, 82, 235], i * 4);
    for (let i = 8; i < 16; i++) colors.set([40, 160, 255, 235], i * 4);
    const binary = {
      length: 2,
      startIndices,
      attributes: {
        getPath: {value: positions, size: 2},
        getColor: {value: colors, size: 4}
      }
    };

    const terrain = new TerrainLayer({
      id: 'deck-terrain-source',
      elevationData: DEM,
      elevationDecoder: decoder,
      minZoom: 0,
      maxZoom: 14,
      strategy: 'no-overlap',
      operation: 'terrain'
    });
    const routes = new PathLayer({
      id: 'binary-routes',
      data: binary,
      _pathType: 'open',
      positionFormat: 'XY',
      getWidth: 4,
      widthUnits: 'pixels',
      widthMinPixels: 2,
      pickable: true,
      antialiasing: true,
      extensions: [new TerrainExtension()],
      terrainDrawMode: 'drape'
    } as never);

    status.textContent = 'binary layers built · creating deck…';

    const deck = new Deck({
      parent: document.getElementById('deck')!,
      views: new MapView({repeat: true}),
      controller: true,
      initialViewState,
      layers: [terrain, routes],
      onViewStateChange: ({viewState}) => {
        map.jumpTo({center: [viewState.longitude, viewState.latitude], zoom: viewState.zoom, bearing: viewState.bearing, pitch: viewState.pitch});
      },
      getTooltip: ({index}) => index >= 0 ? `binary route ${index + 1}` : null,
      onAfterRender: () => {
        status.className = '';
        status.textContent = `ready · ${positions.length / 2} binary vertices · no GeoJSON`;
      }
    });

    Object.assign(window, {__terrainSpike: {map, deck, positions, startIndices, colors}});
  } catch (reason) {
    fail(reason);
  }
}

void main();
