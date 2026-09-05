import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("DuckDB spatial capability", () => {
  it("loads the spatial extension during engine initialization", () => {
    const worker = readFileSync(join(process.cwd(), "src/duckdb.worker.ts"), "utf8");
    const initializeBody = worker.slice(
      worker.indexOf("async function initialize()"),
      worker.indexOf("function viewportPredicate"),
    );

    expect(initializeBody).toContain('await connection!.query("INSTALL spatial; LOAD spatial")');
    expect(worker).not.toContain("sqlUsesSpatial(request.sql)");
    expect(worker).not.toContain("async function ensureSpatialExtension");
  });
});
