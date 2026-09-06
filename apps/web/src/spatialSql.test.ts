import { describe, expect, it } from "vitest";
import { applySpatialFilterSql, polygonBounds } from "./spatialSql";

const polygon: [number, number][] = [[-105.3, 39.9], [-105.1, 39.9], [-105.2, 40.1]];

function parenthesisBalance(sql: string) {
  return [...sql].reduce((balance, character) => balance + (character === "(" ? 1 : character === ")" ? -1 : 0), 0);
}

describe("drawn spatial filters", () => {
  it("leaves SQL unchanged without a completed polygon", () => {
    const sql = "SELECT activity_id FROM activities";
    expect(applySpatialFilterSql(sql)).toBe(sql);
    expect(applySpatialFilterSql(sql, { predicate: "intersects", polygon: polygon.slice(0, 2), visible: false })).toBe(sql);
  });

  it("materializes only bbox-pruned candidate ids before exact geometry checks", () => {
    const result = applySpatialFilterSql("SELECT activity_id FROM activities WHERE start_year = 2026", { predicate: "intersects", polygon, visible: false });
    expect(result).toContain("spatial_user_selection");
    expect(result).toContain("SEMI JOIN spatial_user_selection");
    expect(result).toContain("spatial_candidate_ids AS MATERIALIZED");
    expect(result).toContain("SELECT a.activity_id\n  FROM activities a");
    expect(result).toContain("a.xmax >= -105.3");
    expect(result).toContain("a.xmin <= -105.1");
  });

  it("repeats bbox pruning on the current render geometry relation", () => {
    const result = applySpatialFilterSql("SELECT activity_id FROM activities", { predicate: "intersects", polygon, visible: false });
    expect(result).toContain("FROM activity_geometry a");
    expect(result.match(/a\.xmax >= -105\.3/g)).toHaveLength(2);
    expect(result.match(/a\.xmin <= -105\.1/g)).toHaveLength(2);
    expect(result.match(/a\.ymax >= 39\.9/g)).toHaveLength(2);
    expect(result.match(/a\.ymin <= 40\.1/g)).toHaveLength(2);
  });

  it("uses one polygon geometry and DuckDB Spatial for exact checks", () => {
    const result = applySpatialFilterSql("SELECT activity_id FROM activities", { predicate: "intersects", polygon, visible: false });
    expect(result).toContain("ST_GeomFromText('POLYGON((");
    expect(result).toContain("ST_Intersects(");
    expect(result).toContain("ST_MakeLine(list_transform(a.geometry, lambda p : ST_Point(");
    expect(result).not.toContain("track_points");
    expect(result).not.toContain("squiggles_segments_intersect");
    expect(result).not.toContain("unnest(");
  });

  it("emits balanced SQL for both spatial predicates", () => {
    for (const predicate of ["intersects", "within"] as const) {
      const result = applySpatialFilterSql("SELECT activity_id FROM activities", { predicate, polygon, visible: false });
      expect(parenthesisBalance(result)).toBe(0);
    }
  });

  it("does not let display visibility change selection SQL", () => {
    const hidden = applySpatialFilterSql("SELECT activity_id FROM activities", { predicate: "intersects", polygon, visible: false });
    const shown = applySpatialFilterSql("SELECT activity_id FROM activities", { predicate: "intersects", polygon, visible: true });
    expect(shown).toBe(hidden);
  });

  it("uses ST_Within for the stricter predicate", () => {
    const result = applySpatialFilterSql("SELECT activity_id FROM activities", { predicate: "within", polygon, visible: true });
    expect(result).toContain("WHERE a.xmax >= -105.3");
    expect(result).toContain("AND ST_Within(");
    expect(result).not.toContain("AND ST_Intersects(");
  });

  it("calculates polygon bounds", () => {
    expect(polygonBounds(polygon)).toEqual([-105.3, 39.9, -105.1, 40.1]);
  });
});
