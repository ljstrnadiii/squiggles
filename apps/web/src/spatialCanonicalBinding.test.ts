import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("spatial predicate geometry binding", () => {
  it("uses canonical geometry for drawn spatial predicates", () => {
    const worker = readFileSync(join(process.cwd(), "src/duckdb.worker.ts"), "utf8");
    const executeBlock = worker.slice(
      worker.indexOf('if (request.clean && !supportsClean)', worker.indexOf('if (request.type === "render")')),
      worker.indexOf("selectionAll = isUniversalSelectionSql(request.sql)"),
    );

    expect(executeBlock).toContain(
      "await ensureCanonicalGeometry(request.clean && supportsClean);",
    );
    expect(executeBlock).not.toContain("ensureRenderGeometry(");
  });
});
