import { PathLayer, PolygonLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { SpatialFilter } from "./contracts";

const fill = [71, 107, 204] as const;

export function spatialLayers(filter: SpatialFilter | undefined, drawing: boolean, draft: [number, number][]) {
  const polygon = drawing ? draft : filter?.visible ? filter.polygon : [];
  if (!polygon.length) return [];
  const closed = polygon.length >= 3 ? [...polygon, polygon[0]] : polygon;
  return [
    ...(polygon.length >= 3 ? [new PolygonLayer<[number, number][]>({
      id: drawing ? "spatial-draft-polygon" : "spatial-filter-polygon",
      data: [polygon],
      getPolygon: item => item,
      getFillColor: drawing ? [...fill, 70] : [...fill, 170],
      stroked: false,
      pickable: false,
    })] : []),
    new PathLayer<[number, number][]>({
      id: drawing ? "spatial-draft-outline" : "spatial-filter-outline",
      data: [closed],
      getPath: item => item,
      getColor: [...fill, 255],
      getWidth: 3,
      widthUnits: "pixels",
      pickable: false,
    }),
    ...(drawing ? [new ScatterplotLayer<[number, number]>({
      id: "spatial-draft-vertices",
      data: draft,
      getPosition: item => item,
      getFillColor: [...fill, 255],
      getLineColor: [255, 255, 255, 230],
      getRadius: 5,
      radiusUnits: "pixels",
      stroked: true,
      lineWidthMinPixels: 2,
      pickable: false,
    })] : []),
  ];
}
