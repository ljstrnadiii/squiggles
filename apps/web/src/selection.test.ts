import { describe, expect, it } from "vitest";

import { isUniversalSelectionSql } from "./selection";

describe("isUniversalSelectionSql", () => {
  it("recognizes the canonical all-activities selection", () => {
    expect(isUniversalSelectionSql("SELECT activity_id FROM activities")).toBe(true);
    expect(isUniversalSelectionSql("  select   activity_id\nfrom activities  ")).toBe(true);
  });

  it("does not fast-path filtered or projected queries", () => {
    expect(isUniversalSelectionSql("SELECT activity_id FROM activities WHERE distance_m > 0")).toBe(false);
    expect(isUniversalSelectionSql("SELECT activity_id, distance_m FROM activities")).toBe(false);
  });
});
