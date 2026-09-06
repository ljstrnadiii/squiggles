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

  it("binds spatial selection geometry to the requested render LOD instead of canonical", () => {
    const worker = readFileSync(join(process.cwd(), "src/duckdb.worker.ts"), "utf8");
    const executeBlock = worker.slice(
      worker.indexOf('if (request.clean && !supportsClean)', worker.indexOf('if (request.type === "render")')),
      worker.indexOf("selectionAll = isUniversalSelectionSql(request.sql)"),
    );

    expect(worker).toContain("async function ensureRenderGeometry(lod: Lod, clean: boolean)");
    expect(worker).toContain("const relation = parquetRelation(renderFiles(level), false);");
    expect(executeBlock).toContain(
      "await ensureRenderGeometry(request.lod, request.clean && supportsClean);",
    );
    expect(executeBlock).not.toContain("await ensureCanonicalGeometry(");
  });
});
