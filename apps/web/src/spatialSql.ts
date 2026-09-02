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

function edgesSql(polygon: readonly [number, number][]) {
  return polygon.map((point, index) => {
    const next = polygon[(index + 1) % polygon.length];
    return `(${number(point[0])},${number(point[1])},${number(next[0])},${number(next[1])})`;
  }).join(",");
}

const cross = (ax: string, ay: string, bx: string, by: string, cx: string, cy: string) =>
  `((${bx})-(${ax}))*((${cy})-(${ay}))-((${by})-(${ay}))*((${cx})-(${ax}))`;

function pointInside(point: string) {
  return `(SELECT count(*) % 2 = 1 FROM polygon_edges e WHERE ((e.y1 > ${point}.latitude) != (e.y2 > ${point}.latitude)) AND ${point}.longitude < (e.x2-e.x1)*(${point}.latitude-e.y1)/nullif(e.y2-e.y1,0)+e.x1)`;
}

function segmentCrossesEdges(a: string, b: string) {
  const polygonSideA = cross("e.x1", "e.y1", "e.x2", "e.y2", `${a}.longitude`, `${a}.latitude`);
  const polygonSideB = cross("e.x1", "e.y1", "e.x2", "e.y2", `${b}.longitude`, `${b}.latitude`);
  const routeSideA = cross(`${a}.longitude`, `${a}.latitude`, `${b}.longitude`, `${b}.latitude`, "e.x1", "e.y1");
  const routeSideB = cross(`${a}.longitude`, `${a}.latitude`, `${b}.longitude`, `${b}.latitude`, "e.x2", "e.y2");
  return `EXISTS (
        SELECT 1
        FROM unnest(c.track_points) WITH ORDINALITY p1(point, i)
        CROSS JOIN polygon_edges e
        WHERE p1.i < array_length(c.track_points)
          AND greatest(p1.point.longitude,${b}.longitude) >= least(e.x1,e.x2)
          AND least(p1.point.longitude,${b}.longitude) <= greatest(e.x1,e.x2)
          AND greatest(p1.point.latitude,${b}.latitude) >= least(e.y1,e.y2)
          AND least(p1.point.latitude,${b}.latitude) <= greatest(e.y1,e.y2)
          AND (${polygonSideA}) * (${polygonSideB}) <= 0
          AND (${routeSideA}) * (${routeSideB}) <= 0
      )`;
}

export function applySpatialFilterSql(sql: string, filter?: SpatialFilter): string {
  if (!filter || filter.polygon.length < 3) return sql;
  const [xmin, ymin, xmax, ymax] = polygonBounds(filter.polygon);
  const insideAny = `EXISTS (SELECT 1 FROM unnest(c.track_points) p(point) WHERE ${pointInside("p.point")})`;
  const outsideAny = `EXISTS (SELECT 1 FROM unnest(c.track_points) p(point) WHERE NOT ${pointInside("p.point")})`;
  const nextPoint = `(list_extract(c.track_points,p1.i + 1))`;
  const crosses = segmentCrossesEdges("p1.point", nextPoint);
  const predicate = filter.predicate === "within"
    ? `NOT ${outsideAny} AND NOT ${crosses}`
    : `${insideAny} OR ${crosses}`;
  return `WITH spatial_user_selection AS (
${sql}
),
polygon_edges(x1,y1,x2,y2) AS (VALUES ${edgesSql(filter.polygon)}),
spatial_candidates AS MATERIALIZED (
  SELECT a.activity_id,a.track_points
  FROM activities a
  SEMI JOIN spatial_user_selection s USING(activity_id)
  WHERE a.xmax >= ${number(xmin)} AND a.xmin <= ${number(xmax)}
    AND a.ymax >= ${number(ymin)} AND a.ymin <= ${number(ymax)}
)
SELECT c.activity_id
FROM spatial_candidates c
WHERE ${predicate}`;
}
