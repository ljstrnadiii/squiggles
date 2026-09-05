import { describe, expect, it } from "vitest";

import { activityFamilyFromCanonicalPath, canonicalSourceSql } from "./canonicalSource";

describe("canonical source SQL", () => {
  it("uses one multi-file read_parquet call with Hive partitioning", () => {
    const sql = canonicalSourceSql([
      { name: "builds/v3/activities/activity_family=run/part-000.parquet" },
      { name: "builds/v3/activities/activity_family=ride/part-001.parquet" },
    ]);

    expect(sql).toContain("read_parquet([");
    expect(sql).toContain("hive_partitioning=true");
    expect(sql).toContain("activity_family");
    expect(sql).not.toContain(" UNION ALL ");
    expect((sql.match(/read_parquet/g) ?? []).length).toBe(1);
  });

  it("fails loudly when a canonical file is outside the expected partition layout", () => {
    expect(() => activityFamilyFromCanonicalPath("builds/v3/activities/part-000.parquet")).toThrow(
      "missing activity_family partition",
    );
  });
});
