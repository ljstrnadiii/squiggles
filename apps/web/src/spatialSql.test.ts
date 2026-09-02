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
    expect(result).not.toContain("SELECT a.activity_id,a.track_points");
    expect(result).toContain("a.xmax >= -105.3");
    expect(result).toContain("a.xmin <= -105.1");
  });

  it("keeps exact point and segment tests row-local without unnesting routes", () => {
    const result = applySpatialFilterSql("SELECT activity_id FROM activities", { predicate: "intersects", polygon, visible: false });
    expect(result).toContain("list_transform(a.track_points,lambda p :");
    expect(result).toContain("list_transform(range(1,array_length(a.track_points)),lambda i :");
    expect(result).toContain("struct_extract(p,'longitude')");
    expect(result).toContain("struct_extract(list_extract(a.track_points,i),'longitude')");
    expect(result).toContain("struct_extract(list_extract(a.track_points,i + 1),'latitude')");
    expect(result).not.toContain("p ->");
    expect(result).not.toContain("i ->");
    expect(result).not.toContain("unnest(");
    expect(result).not.toContain("CROSS JOIN polygon_edges");
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

  it("uses the stricter within predicate", () => {
    const result = applySpatialFilterSql("SELECT activity_id FROM activities", { predicate: "within", polygon, visible: true });
    expect(result).toContain("WHERE NOT list_contains");
    expect(result).toContain("AND NOT list_contains");
  });

  it("calculates polygon bounds", () => {
    expect(polygonBounds(polygon)).toEqual([-105.3, 39.9, -105.1, 40.1]);
  });
});
