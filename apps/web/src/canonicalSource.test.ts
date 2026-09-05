import { describe, expect, it } from "vitest";

import { activityFamilyFromCanonicalPath, canonicalSourceSql } from "./canonicalSource";

describe("canonical source SQL", () => {
  it("injects activity_family explicitly instead of asking DuckDB to parse Hive paths", () => {
    const sql = canonicalSourceSql([
      { name: "builds/v3/activities/activity_family=run/part-000.parquet" },
      { name: "builds/v3/activities/activity_family=ride/part-001.parquet" },
    ]);

    expect(sql).toContain("'run' AS activity_family");
    expect(sql).toContain("'ride' AS activity_family");
    expect(sql).toContain("hive_partitioning=false");
    expect(sql).not.toContain("hive_partitioning=true");
    expect(sql).toContain(" UNION ALL ");
  });

  it("fails loudly when a canonical file is outside the expected partition layout", () => {
    expect(() => activityFamilyFromCanonicalPath("builds/v3/activities/part-000.parquet")).toThrow(
      "missing activity_family partition",
    );
  });
});
