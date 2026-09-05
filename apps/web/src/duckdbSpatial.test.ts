import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("DuckDB spatial selection startup", () => {
  it("loads the spatial extension lazily for SQL that uses ST_ functions", () => {
    const worker = readFileSync(join(process.cwd(), "src/duckdb.worker.ts"), "utf8");

    expect(worker).toContain("async function ensureSpatialExtension");
    expect(worker).toContain('sqlUsesSpatial(request.sql)');
    expect(worker).toContain('await connection!.query("INSTALL spatial; LOAD spatial")');

    const initializeBody = worker.slice(
      worker.indexOf("async function initialize()"),
      worker.indexOf("function viewportPredicate"),
    );
    expect(initializeBody).not.toContain("INSTALL spatial");
  });
});
