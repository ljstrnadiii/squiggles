import { describe, expect, it } from "vitest";
import { applySpatialFilterSql, polygonBounds } from "./spatialSql";

const polygon: [number, number][] = [[-105.3, 39.9], [-105.1, 39.9], [-105.2, 40.1]];

describe("drawn spatial filters", () => {
  it("leaves SQL unchanged without a completed polygon", () => {
    const sql = "SELECT activity_id FROM activities";
    expect(applySpatialFilterSql(sql)).toBe(sql);
    expect(applySpatialFilterSql(sql, { predicate: "intersects", polygon: polygon.slice(0, 2), visible: false })).toBe(sql);
  });

  it("wraps the user query and prunes candidates by polygon bounds", () => {
    const result = applySpatialFilterSql("SELECT activity_id FROM activities WHERE start_year = 2026", { predicate: "intersects", polygon, visible: false });
    expect(result).toContain("spatial_user_selection");
    expect(result).toContain("SEMI JOIN spatial_user_selection");
    expect(result).toContain("a.xmax >= -105.3");
    expect(result).toContain("a.xmin <= -105.1");
    expect(result).toContain("WITH ORDINALITY");
    expect(result).toContain("OR EXISTS");
  });

  it("does not let display visibility change selection SQL", () => {
    const hidden = applySpatialFilterSql("SELECT activity_id FROM activities", { predicate: "intersects", polygon, visible: false });
    const shown = applySpatialFilterSql("SELECT activity_id FROM activities", { predicate: "intersects", polygon, visible: true });
    expect(shown).toBe(hidden);
  });

  it("uses the stricter within predicate", () => {
    const result = applySpatialFilterSql("SELECT activity_id FROM activities", { predicate: "within", polygon, visible: true });
    expect(result).toContain("WHERE NOT EXISTS");
    expect(result).toContain("AND NOT EXISTS");
  });

  it("calculates polygon bounds", () => {
    expect(polygonBounds(polygon)).toEqual([-105.3, 39.9, -105.1, 40.1]);
  });
});
