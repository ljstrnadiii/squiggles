import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("DuckDB worker startup", () => {
  it("loads the spatial extension during startup", () => {
    const source = readFileSync(join(process.cwd(), "src/duckdb.worker.ts"), "utf8");
    const initializeBody = source.slice(
      source.indexOf("async function initialize()"),
      source.indexOf("function viewportPredicate"),
    );

    expect(initializeBody).toContain('await connection.query("INSTALL spatial; LOAD spatial")');
  });

  it("reports the expensive worker-open phases", () => {
    const worker = readFileSync(join(process.cwd(), "src/duckdb.worker.ts"), "utf8");
    const engine = readFileSync(join(process.cwd(), "src/engine.ts"), "utf8");

    for (const phase of [
      "selectBundleMs",
      "instantiateMs",
      "connectMs",
      "registerFilesMs",
      "activitySourceViewMs",
      "activitiesViewMs",
    ]) {
      expect(worker).toContain(phase);
      expect(engine).toContain(phase);
    }
    expect(engine).toContain('perf("worker-open-phases"');
  });
});
