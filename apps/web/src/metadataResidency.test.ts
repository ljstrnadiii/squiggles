import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const source = readFileSync(join(import.meta.dirname, "duckdb.worker.ts"), "utf8");

describe("DuckDB metadata residency", () => {
  it("materializes metadata once and reuses the resident table", () => {
    expect(source).toContain("let metadataMaterialized = false");
    expect(source).toContain("async function ensureMetadataMaterialized()");
    expect(source).toContain("await connection!.query(materializeMetadataSql())");
    expect(source).toContain('"metadata-materialized"');
  });

  it("routes activities, stats, and table reads through resident metadata", () => {
    expect(source).toContain("await ensureMetadataMaterialized();");
    expect(source).toContain("const relation = residentMetadataRelation(clean)");
    expect(source).not.toContain("const relation = viewportRelation(files, clean)");
  });

  it("resets residency when a different dataset opens", () => {
    expect(source).toContain("metadataMaterialized = false");
  });
});
