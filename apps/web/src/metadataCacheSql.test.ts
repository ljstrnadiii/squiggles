import { describe, expect, it } from "vitest";

import {
  METADATA_CACHE_TABLE,
  materializeMetadataSql,
  residentMetadataRelation,
} from "./metadataCacheSql";

describe("resident metadata SQL", () => {
  it("materializes the remote metadata source into one temp table", () => {
    expect(materializeMetadataSql()).toBe(
      `CREATE OR REPLACE TEMP TABLE ${METADATA_CACHE_TABLE} AS SELECT * FROM activity_source`,
    );
  });

  it("uses the resident table directly for raw metadata reads", () => {
    expect(residentMetadataRelation(false)).toBe(METADATA_CACHE_TABLE);
  });

  it("applies clean scalar replacements on top of the resident table", () => {
    const relation = residentMetadataRelation(true);
    expect(relation).toContain(`FROM ${METADATA_CACHE_TABLE}`);
    expect(relation).toContain("clean_point_count AS point_count");
    expect(relation).toContain("clean_xmin AS xmin");
  });
});
