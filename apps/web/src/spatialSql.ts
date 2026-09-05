import type { SpatialFilter } from "./contracts";

function number(value: number) {
  if (!Number.isFinite(value)) throw new Error("Spatial filter coordinates must be finite");
  return Number(value.toFixed(7)).toString();
}

export function polygonBounds(polygon: readonly [number, number][]): [number, number, number, number] {
  if (polygon.length < 3) throw new Error("Spatial filter needs at least three vertices");
  const xs = polygon.map(point => point[0]);
  const ys = polygon.map(point => point[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function polygonWkt(polygon: readonly [number, number][]) {
  const ring = [...polygon, polygon[0]];
  return `POLYGON((${ring.map(([longitude, latitude]) => `${number(longitude)} ${number(latitude)}`).join(",")}))`;
}

function activityGeometry() {
  return "ST_MakeLine(list_transform(a.geometry, lambda p : ST_Point(list_extract(p,1),list_extract(p,2))))";
}

export function applySpatialFilterSql(sql: string, filter?: SpatialFilter): string {
  if (!filter || filter.polygon.length < 3) return sql;
  const [xmin, ymin, xmax, ymax] = polygonBounds(filter.polygon);
  const polygon = `ST_GeomFromText('${polygonWkt(filter.polygon)}')`;
  const route = activityGeometry();
  const predicate = filter.predicate === "within"
    ? `ST_Within(${route}, spatial_polygon.geom)`
    : `ST_Intersects(${route}, spatial_polygon.geom)`;
  return `WITH spatial_user_selection AS (
${sql}
),
spatial_polygon AS MATERIALIZED (
  SELECT ${polygon} AS geom
),
spatial_candidate_ids AS MATERIALIZED (
  SELECT a.activity_id
  FROM activities a
  SEMI JOIN spatial_user_selection s USING(activity_id)
  WHERE a.xmax >= ${number(xmin)} AND a.xmin <= ${number(xmax)}
    AND a.ymax >= ${number(ymin)} AND a.ymin <= ${number(ymax)}
)
SELECT a.activity_id
FROM activity_geometry a
SEMI JOIN spatial_candidate_ids c USING(activity_id)
CROSS JOIN spatial_polygon
WHERE ${predicate}`;
}
