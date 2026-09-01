import { describe, expect, it } from "vitest";

import { normalizeSelectionSql } from "./querySql";

describe("normalizeSelectionSql", () => {
  it("removes trailing semicolons and surrounding whitespace", () => {
    expect(normalizeSelectionSql("  SELECT activity_id FROM activities;\n")).toBe("SELECT activity_id FROM activities");
    expect(normalizeSelectionSql("SELECT activity_id FROM activities;;;   ")).toBe("SELECT activity_id FROM activities");
  });

  it("preserves semicolons inside the query body", () => {
    expect(normalizeSelectionSql("SELECT ';' AS marker, activity_id FROM activities;"))
      .toBe("SELECT ';' AS marker, activity_id FROM activities");
  });
});
