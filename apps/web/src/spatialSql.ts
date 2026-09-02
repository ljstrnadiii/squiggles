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

const cross = (ax: string, ay: string, bx: string, by: string, cx: string, cy: string) =>
  `((${bx})-(${ax}))*((${cy})-(${ay}))-((${by})-(${ay}))*((${cx})-(${ax}))`;

function pointInside(point: string, polygon: readonly [number, number][]) {
  const crossings = polygon.map((edge, index) => {
    const next = polygon[(index + 1) % polygon.length];
    const x1 = number(edge[0]);
    const y1 = number(edge[1]);
    const x2 = number(next[0]);
    const y2 = number(next[1]);
    return `CASE WHEN ((${y1} > ${point}.latitude) != (${y2} > ${point}.latitude)) AND ${point}.longitude < (${x2}-${x1})*(${point}.latitude-${y1})/nullif(${y2}-${y1},0)+${x1} THEN 1 ELSE 0 END`;
  });
  return `((${crossings.join("+")}) % 2 = 1)`;
}

function segmentCrossesPolygon(a: string, b: string, polygon: readonly [number, number][]) {
  const edges = polygon.map((edge, index) => {
    const next = polygon[(index + 1) % polygon.length];
    const x1 = number(edge[0]);
    const y1 = number(edge[1]);
    const x2 = number(next[0]);
    const y2 = number(next[1]);
    const polygonSideA = cross(x1, y1, x2, y2, `${a}.longitude`, `${a}.latitude`);
    const polygonSideB = cross(x1, y1, x2, y2, `${b}.longitude`, `${b}.latitude`);
    const routeSideA = cross(`${a}.longitude`, `${a}.latitude`, `${b}.longitude`, `${b}.latitude`, x1, y1);
    const routeSideB = cross(`${a}.longitude`, `${a}.latitude`, `${b}.longitude`, `${b}.latitude`, x2, y2);
    return `(greatest(${a}.longitude,${b}.longitude) >= least(${x1},${x2})
      AND least(${a}.longitude,${b}.longitude) <= greatest(${x1},${x2})
      AND greatest(${a}.latitude,${b}.latitude) >= least(${y1},${y2})
      AND least(${a}.latitude,${b}.latitude) <= greatest(${y1},${y2})
      AND (${polygonSideA}) * (${polygonSideB}) <= 0
      AND (${routeSideA}) * (${routeSideB}) <= 0)`;
  });
  return `(${edges.join(" OR ")})`;
}

export function applySpatialFilterSql(sql: string, filter?: SpatialFilter): string {
  if (!filter || filter.polygon.length < 3) return sql;
  const [xmin, ymin, xmax, ymax] = polygonBounds(filter.polygon);
  const inside = pointInside("p", filter.polygon);
  const insideAny = `array_length(list_filter(a.track_points,p->${inside})) > 0`;
  const outsideAny = `array_length(list_filter(a.track_points,p->NOT ${inside})) > 0`;
  const pointA = `(list_extract(a.track_points,i))`;
  const pointB = `(list_extract(a.track_points,i + 1))`;
  const segmentCrosses = segmentCrossesPolygon(pointA, pointB, filter.polygon);
  const crosses = `array_length(list_filter(range(1,array_length(a.track_points)),i->${segmentCrosses})) > 0`;
  const predicate = filter.predicate === "within"
    ? `NOT (${outsideAny}) AND NOT (${crosses})`
    : `(${insideAny}) OR (${crosses})`;
  return `WITH spatial_user_selection AS (
${sql}
)
SELECT a.activity_id
FROM activities a
SEMI JOIN spatial_user_selection s USING(activity_id)
WHERE a.xmax >= ${number(xmin)} AND a.xmin <= ${number(xmax)}
  AND a.ymax >= ${number(ymin)} AND a.ymin <= ${number(ymax)}
  AND (${predicate})`;
}
