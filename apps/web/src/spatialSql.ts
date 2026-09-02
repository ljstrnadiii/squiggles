import type { SpatialFilter } from "./contracts";

type PointSql = { longitude: string; latitude: string };

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

function polygonEdges(polygon: readonly [number, number][]) {
  return polygon.map((point, index) => ({ point, next: polygon[(index + 1) % polygon.length] }));
}

function pointInside(point: PointSql, polygon: readonly [number, number][]) {
  const crossings = polygonEdges(polygon).map(({ point: edge, next }) => {
    const x1 = number(edge[0]);
    const y1 = number(edge[1]);
    const x2 = number(next[0]);
    const y2 = number(next[1]);
    return `CASE WHEN ((${y1} > ${point.latitude}) != (${y2} > ${point.latitude})) AND ${point.longitude} < (${x2}-${x1})*(${point.latitude}-${y1})/nullif(${y2}-${y1},0)+${x1} THEN 1 ELSE 0 END`;
  });
  return `((${crossings.join("+")}) % 2 = 1)`;
}

function lambdaPoint(name: string): PointSql {
  return {
    longitude: `struct_extract(${name},'longitude')`,
    latitude: `struct_extract(${name},'latitude')`,
  };
}

function anyPointInside(track: string, polygon: readonly [number, number][]) {
  return `list_contains(list_transform(${track},lambda p : ${pointInside(lambdaPoint("p"), polygon)}),true)`;
}

function anyPointOutside(track: string, polygon: readonly [number, number][]) {
  return `list_contains(list_transform(${track},lambda p : NOT ${pointInside(lambdaPoint("p"), polygon)}),true)`;
}

function routeSegmentList(track: string) {
  const current = `list_extract(${track},i)`;
  const next = `list_extract(${track},i + 1)`;
  return `list_transform(range(1,array_length(${track})),lambda i : {'x1':struct_extract(${current},'longitude'),'y1':struct_extract(${current},'latitude'),'x2':struct_extract(${next},'longitude'),'y2':struct_extract(${next},'latitude')})`;
}

function field(name: string, key: string) {
  return `struct_extract(${name},'${key}')`;
}

function segmentMacroCall(segment: string, edge: [number, number], next: [number, number]) {
  return `squiggles_segments_intersect(${field(segment, "x1")},${field(segment, "y1")},${field(segment, "x2")},${field(segment, "y2")},${number(edge[0])},${number(edge[1])},${number(next[0])},${number(next[1])})`;
}

function anySegmentCrosses(track: string, polygon: readonly [number, number][]) {
  const crosses = polygonEdges(polygon).map(({ point, next }) => segmentMacroCall("s", point, next)).join(" OR ");
  return `list_contains(list_transform(${routeSegmentList(track)},lambda s : (${crosses})),true)`;
}

export function applySpatialFilterSql(sql: string, filter?: SpatialFilter): string {
  if (!filter || filter.polygon.length < 3) return sql;
  const [xmin, ymin, xmax, ymax] = polygonBounds(filter.polygon);
  const track = "a.track_points";
  const insideAny = anyPointInside(track, filter.polygon);
  const outsideAny = anyPointOutside(track, filter.polygon);
  const crosses = anySegmentCrosses(track, filter.polygon);
  const predicate = filter.predicate === "within"
    ? `NOT ${outsideAny} AND NOT ${crosses}`
    : `${insideAny} OR ${crosses}`;
  return `WITH spatial_user_selection AS (
${sql}
),
spatial_candidate_ids AS MATERIALIZED (
  SELECT a.activity_id
  FROM activities a
  SEMI JOIN spatial_user_selection s USING(activity_id)
  WHERE a.xmax >= ${number(xmin)} AND a.xmin <= ${number(xmax)}
    AND a.ymax >= ${number(ymin)} AND a.ymin <= ${number(ymax)}
)
SELECT a.activity_id
FROM activities a
SEMI JOIN spatial_candidate_ids c USING(activity_id)
WHERE ${predicate}`;
}
