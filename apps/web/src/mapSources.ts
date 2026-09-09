import type * as maplibregl from "maplibre-gl";

import type { Basemap } from "./contracts";

export type RasterBasemapSource = {
  tiles: string[];
  tileSize: number;
  attribution: string;
  maxzoom: number;
};

export type TerrainDemSource = {
  type: "raster-dem";
  url: string;
};

const MAPBOX_ATTRIBUTION = '<a href="https://www.mapbox.com/about/maps/" target="_blank">© Mapbox</a> <a href="https://www.openstreetmap.org/copyright/" target="_blank">© OpenStreetMap</a> <a href="https://www.mapbox.com/contribute/" target="_blank">Improve this map</a>';
const MAPBOX_SATELLITE_ATTRIBUTION = `${MAPBOX_ATTRIBUTION} <a href="https://www.maxar.com/" target="_blank">© Maxar</a>`;

export function rasterBasemapSources(mapboxToken?: string, cartoKey?: string): Record<Exclude<Basemap, "blank">, RasterBasemapSource> {
  const cartoQuery = cartoKey ? `?key=${encodeURIComponent(cartoKey)}` : "";
  const imagery = mapboxToken
    ? {
        tiles: [`https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}@2x.jpg90?access_token=${encodeURIComponent(mapboxToken)}`],
        tileSize: 512,
        attribution: MAPBOX_SATELLITE_ATTRIBUTION,
        maxzoom: 22,
      }
    : {
        tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
        tileSize: 256,
        attribution: "Sources: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
        maxzoom: 19,
      };
  return {
    "carto-light": { tiles: [`https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png${cartoQuery}`], tileSize: 256, attribution: "© OpenStreetMap contributors © CARTO", maxzoom: 20 },
    "carto-dark": { tiles: [`https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png${cartoQuery}`], tileSize: 256, attribution: "© OpenStreetMap contributors © CARTO", maxzoom: 20 },
    streets: { tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, attribution: "© OpenStreetMap contributors", maxzoom: 19 },
    topo: { tiles: ["https://tile.opentopomap.org/{z}/{x}/{y}.png"], tileSize: 256, attribution: "Map data © OpenStreetMap contributors, SRTM | Map style © OpenTopoMap (CC-BY-SA)", maxzoom: 17 },
    imagery,
  };
}

export function terrainDemSource(): TerrainDemSource {
  return { type: "raster-dem", url: "https://tiles.mapterhorn.com/tilejson.json" };
}

export const rasterStyles = rasterBasemapSources(import.meta.env.VITE_MAPBOX_ACCESS_TOKEN, import.meta.env.VITE_CARTO_API_KEY);
export const terrainSource = terrainDemSource() satisfies maplibregl.RasterDEMSourceSpecification;
