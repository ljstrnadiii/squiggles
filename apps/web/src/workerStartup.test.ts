import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("DuckDB worker startup", () => {
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

  it("creates activity_source from a SELECT over read_parquet and keeps canonical lazy", () => {
    const worker = readFileSync(join(process.cwd(), "src/duckdb.worker.ts"), "utf8");

    expect(worker).toContain(
      "const metadataRelation = parquetRelation(request.metadataFiles, false);",
    );
    expect(worker).toContain(
      "CREATE OR REPLACE VIEW activity_source AS SELECT * FROM ${metadataRelation}",
    );
    expect(worker).not.toContain(
      "CREATE OR REPLACE VIEW activity_source AS ${parquetRelation(request.metadataFiles, false)}",
    );

    const openBlock = worker.slice(
      worker.indexOf('if (request.type === "open")'),
      worker.indexOf('if (request.type === "metadata")'),
    );
    expect(openBlock).not.toContain("CREATE OR REPLACE VIEW canonical_source");
  });
});
