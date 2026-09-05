import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("DuckDB worker startup", () => {
  it("does not install or load the spatial extension on startup", () => {
    const source = readFileSync(join(process.cwd(), "src/duckdb.worker.ts"), "utf8");

    // Keep startup free of unused extension installation/loading work.
    expect(source).not.toContain("INSTALL spatial");
    expect(source).not.toContain("LOAD spatial");
  });

  it("reports the expensive worker-open phases", () => {
    const worker = readFileSync(join(process.cwd(), "src/duckdb.worker.ts"), "utf8");
    const engine = readFileSync(join(process.cwd(), "src/engine.ts"), "utf8");

    // These timings make production worker-open regressions actionable.
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
