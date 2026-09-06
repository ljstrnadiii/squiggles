import { describe, expect, it } from "vitest";

import {
  activityFamilyFromCanonicalPath,
  canonicalFileForPath,
  canonicalSourceSql,
  targetedCanonicalSourceSql,
} from "./canonicalSource";

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

  it("resolves a compiler locator against a registered canonical path suffix", () => {
    const files = [
      { name: "builds/v3/activities/activity_family=run/part-000.parquet" },
      { name: "builds/v3/activities/activity_family=ride/part-001.parquet" },
    ];

    expect(
      canonicalFileForPath(files, "activities/activity_family=run/part-000.parquet").name,
    ).toBe("builds/v3/activities/activity_family=run/part-000.parquet");
  });

  it("targets exactly one canonical file for detail reads", () => {
    const sql = targetedCanonicalSourceSql(
      [
        { name: "builds/v3/activities/activity_family=run/part-000.parquet" },
        { name: "builds/v3/activities/activity_family=ride/part-001.parquet" },
      ],
      "activities/activity_family=ride/part-001.parquet",
    );

    expect(sql).toBe(
      "read_parquet(['builds/v3/activities/activity_family=ride/part-001.parquet'],hive_partitioning=true)",
    );
    expect(sql).not.toContain("part-000.parquet");
  });

  it("fails loudly for missing or ambiguous locator paths", () => {
    expect(() =>
      canonicalFileForPath(
        [{ name: "builds/v3/activities/activity_family=run/part-000.parquet" }],
        "activities/activity_family=ride/part-001.parquet",
      ),
    ).toThrow("not registered");

    expect(() =>
      canonicalFileForPath(
        [
          { name: "a/activities/activity_family=run/part-000.parquet" },
          { name: "b/activities/activity_family=run/part-000.parquet" },
        ],
        "activities/activity_family=run/part-000.parquet",
      ),
    ).toThrow("ambiguous");
  });

  it("fails loudly when a canonical file is outside the expected partition layout", () => {
    expect(() => activityFamilyFromCanonicalPath("builds/v3/activities/part-000.parquet")).toThrow(
      "missing activity_family partition",
    );
  });
});
